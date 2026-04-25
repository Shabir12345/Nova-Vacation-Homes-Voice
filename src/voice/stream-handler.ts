// WebSocket handler for Twilio Media Streams
// Receives raw audio from the caller, transcribes it, feeds it to the agent,
// and streams TTS audio back.
//
// Twilio Media Stream protocol:
//   connected  → stream is ready
//   start      → call metadata
//   media      → base64 mulaw audio chunk (8kHz)
//   stop       → call ended

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { AgentOrchestrator } from '../agent';
import { logger } from '../utils/logger';

// Twilio media stream message shapes
interface TwilioConnectedMessage { event: 'connected'; protocol: string; version: string }
interface TwilioStartMessage { event: 'start'; sequenceNumber: string; start: { streamSid: string; callSid: string; customParameters: Record<string, string> } }
interface TwilioMediaMessage { event: 'media'; sequenceNumber: string; media: { track: string; chunk: string; timestamp: string; payload: string } }
interface TwilioStopMessage { event: 'stop'; sequenceNumber: string; stop: { accountSid: string; callSid: string } }
type TwilioMessage = TwilioConnectedMessage | TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage;

export const createStreamServer = (port: number): WebSocketServer => {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ url: req.url }, 'Media stream WebSocket connected');

    let callSid: string | null = null;
    const audioBuffer: Buffer[] = [];
    let transcriptionBuffer = '';

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as TwilioMessage;

        switch (message.event) {
          case 'connected':
            logger.debug('Stream connected');
            break;

          case 'start': {
            callSid = message.start.callSid;
            logger.info({ callSid }, 'Stream started');

            // Send initial greeting from the agent
            const greeting = await AgentOrchestrator.getGreeting(callSid);
            if (greeting.agentResponse) {
              await sendTTS(ws, greeting.agentResponse, message.start.streamSid);
            }
            break;
          }

          case 'media': {
            if (!callSid) break;

            // Buffer incoming audio
            const audioChunk = Buffer.from(message.media.payload, 'base64');
            audioBuffer.push(audioChunk);

            // In production: pipe to real-time STT (e.g. Deepgram, OpenAI Whisper)
            // For now: placeholder — process when silence detected
            // TODO: Integrate Deepgram WebSocket STT for real-time transcription
            break;
          }

          case 'stop': {
            const stoppedCallSid = message.stop.callSid;
            logger.info({ callSid: stoppedCallSid }, 'Stream stopped');
            await AgentOrchestrator.endSession(stoppedCallSid);
            ws.close();
            break;
          }
        }
      } catch (err) {
        logger.error(err, 'Error processing stream message');
      }
    });

    ws.on('close', async () => {
      if (callSid) {
        logger.info({ callSid }, 'WebSocket closed');
        await AgentOrchestrator.endSession(callSid).catch(() => undefined);
      }
    });

    ws.on('error', (err) => {
      logger.error(err, 'WebSocket error');
    });
  });

  logger.info({ port }, 'Media stream WebSocket server listening');
  return wss;
};

// Send agent text response as TwiML Play (in production: convert to audio via TTS)
const sendTTS = async (
  ws: WebSocket,
  text: string,
  streamSid: string
): Promise<void> => {
  // In production: call a TTS service (ElevenLabs, Google TTS, Twilio TTS)
  // and send the audio back via the WebSocket as mulaw chunks
  // For now: log what would be spoken
  logger.info({ streamSid, text }, '[TTS] Agent would say');
  // TODO: Integrate TTS provider and stream audio back
};

// Process buffered audio through STT (called after silence detection)
export const processAudioBuffer = async (
  audioBuffer: Buffer[],
  callSid: string,
  ws: WebSocket,
  streamSid: string
): Promise<void> => {
  if (audioBuffer.length === 0) return;

  // TODO: Send combined buffer to STT service and get transcript
  const transcript = '[STT transcription placeholder]';
  logger.info({ callSid, transcript }, 'Transcription received');

  // Feed transcript to agent
  const result = await AgentOrchestrator.handleMessage(callSid, transcript);

  if (result.agentResponse) {
    await sendTTS(ws, result.agentResponse, streamSid);
  }

  // If escalated, signal Twilio to transfer the call
  if (result.escalated) {
    logger.info({ callSid }, 'Escalating call to human');
    // TODO: Send Twilio REST API call to transfer to human queue
  }
};
