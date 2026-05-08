// Browser ↔ Agent voice bridge for the test UI.
//
// Protocol (browser → server):
//   { type: 'start' }                      — begin a new session
//   { type: 'audio', data: <base64 PCM> }  — raw 16-bit PCM @ 16 kHz mono chunks
//   { type: 'stop_audio' }                 — end of utterance (push-to-talk released)
//   { type: 'end' }                        — hang up
//
// Protocol (server → browser):
//   { type: 'ready',       sessionId, greeting }
//   { type: 'transcript',  text, final }   — live STT feedback
//   { type: 'agent_token', text, final }   — streaming agent text tokens
//   { type: 'audio',       data: <base64> } — ElevenLabs TTS audio chunk (MP3)
//   { type: 'state',       state, topIntent, language }
//   { type: 'error',       message }
//   { type: 'call_ended' }

import WebSocket, { WebSocketServer } from 'ws';
import https from 'https';
import http from 'http';
import { AgentOrchestrator } from '../agent';
import { forceMemoryMode } from '../utils/session-store';
import { logger } from '../utils/logger';
import { config } from '../config';

// ── Deepgram live transcription ────────────────────────────────────────────────

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVEN_KEY   = process.env.ELEVENLABS_API_KEY;

function openDeepgramSocket(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (msg: string) => void,
): WebSocket | null {
  if (!DEEPGRAM_KEY) {
    onError('DEEPGRAM_API_KEY not set — speech recognition unavailable');
    return null;
  }

  const params = new URLSearchParams({
    model:          'nova-3-general',
    language:       'en-US',
    encoding:       'linear16',
    sample_rate:    '16000',
    channels:       '1',
    interim_results:'true',
    endpointing:    '300',   // ms silence before final transcript
    smart_format:   'true',
    punctuate:      'true',
  });

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const alt = msg?.channel?.alternatives?.[0];
      if (!alt) return;
      const text = alt.transcript?.trim();
      if (!text) return;
      const isFinal = msg.is_final === true;
      onTranscript(text, isFinal);
    } catch { /* ignore parse errors */ }
  });

  ws.on('error', (err) => {
    logger.warn({ err }, 'Deepgram WS error');
    onError('Deepgram connection error');
  });

  return ws;
}

// ── ElevenLabs TTS ─────────────────────────────────────────────────────────────

async function synthesize(
  text: string,
  voiceId: string,
  onChunk: (buf: Buffer) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!ELEVEN_KEY) {
    logger.warn('ELEVENLABS_API_KEY not set — TTS skipped');
    return;
  }

  const body = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',   // lowest-latency ElevenLabs model
    voice_settings: {
      stability:        config.CR_VOICE_STABILITY,
      similarity_boost: config.CR_VOICE_SIMILARITY,
      speed:            config.CR_VOICE_SPEED,
    },
    output_format: 'mp3_44100_128',
  });

  return new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path:     `/v1/text-to-speech/${voiceId}/stream`,
        method:   'POST',
        headers: {
          'xi-api-key':   ELEVEN_KEY,
          'Content-Type': 'application/json',
          Accept:         'audio/mpeg',
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`ElevenLabs HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (chunk: Buffer) => {
          if (!signal?.aborted) onChunk(chunk);
        });
        res.on('end', resolve);
        res.on('error', reject);
      },
    );

    req.on('error', reject);

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        resolve();
      });
    }

    req.write(body);
    req.end();
  });
}

// ── Per-session state ──────────────────────────────────────────────────────────

interface SessionState {
  sessionId: string;
  dgSocket:  WebSocket | null;
  turnAbort: AbortController | null;
}

// ── WebSocket handler ──────────────────────────────────────────────────────────

const send = (ws: WebSocket, msg: object) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

function handleConnection(clientWs: WebSocket): void {
  const state: SessionState = { sessionId: '', dgSocket: null, turnAbort: null };

  const cleanup = async () => {
    state.turnAbort?.abort();
    if (state.dgSocket && state.dgSocket.readyState === WebSocket.OPEN) {
      state.dgSocket.close();
    }
    if (state.sessionId) {
      await AgentOrchestrator.endSession(state.sessionId).catch(() => undefined);
    }
  };

  clientWs.on('message', async (raw) => {
    let msg: { type: string; data?: string };
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    switch (msg.type) {
      // ── start ────────────────────────────────────────────────────────────────
      case 'start': {
        try {
          forceMemoryMode();
          state.sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await AgentOrchestrator.startSession(state.sessionId, 'browser-test');
          const greeting = await AgentOrchestrator.getGreeting(state.sessionId);

          send(clientWs, { type: 'ready', sessionId: state.sessionId, greeting });

          // Stream greeting through ElevenLabs if available
          const voiceId = config.CR_VOICE_EN;
          if (ELEVEN_KEY) {
            const abort = new AbortController();
            state.turnAbort = abort;
            await synthesize(greeting, voiceId, (chunk) => {
              send(clientWs, { type: 'audio', data: chunk.toString('base64') });
            }, abort.signal).catch((err) => logger.warn(err, 'TTS error on greeting'));
            send(clientWs, { type: 'audio_done' });
            state.turnAbort = null;
          }
        } catch (err) {
          logger.error(err, 'Failed to start test session');
          send(clientWs, { type: 'error', message: 'Failed to start session' });
        }
        break;
      }

      // ── audio ─────────────────────────────────────────────────────────────────
      case 'audio': {
        if (!msg.data || !state.sessionId) break;

        // Open Deepgram socket lazily on first audio chunk
        if (!state.dgSocket || state.dgSocket.readyState !== WebSocket.OPEN) {
          state.dgSocket = openDeepgramSocket(
            async (text, isFinal) => {
              // Forward live transcript to browser
              send(clientWs, { type: 'transcript', text, final: isFinal });

              if (!isFinal) return;

              // Cancel any ongoing TTS playback
              state.turnAbort?.abort();
              const abort = new AbortController();
              state.turnAbort = abort;

              // Run agent and stream response
              let fullText = '';
              let agentState = '';
              let topIntent = '';
              let language = 'en';

              try {
                for await (const event of AgentOrchestrator.handleMessageStream(
                  state.sessionId, text, abort.signal,
                )) {
                  if (abort.signal.aborted) break;

                  switch (event.type) {
                    case 'token':
                      if (event.text) {
                        fullText += event.text;
                        send(clientWs, { type: 'agent_token', text: event.text, final: false });
                      }
                      break;
                    case 'final':
                      agentState = (event as any).state  ?? agentState;
                      topIntent  = (event as any).intent ?? topIntent;
                      language   = (event as any).lang   ?? language;
                      send(clientWs, { type: 'agent_token', text: '', final: true });
                      break;
                  }
                }
              } catch (err: any) {
                if (err?.name !== 'AbortError') {
                  logger.error(err, 'Agent error');
                  send(clientWs, { type: 'error', message: 'Agent error' });
                }
                return;
              }

              // Fetch updated session state
              const session = await AgentOrchestrator.getSession(state.sessionId).catch(() => null);
              if (session) {
                send(clientWs, {
                  type:      'state',
                  state:     session.state,
                  topIntent: session.topIntent ?? '—',
                  language:  session.language  ?? 'en',
                });
                if (session.state === 'ESCALATED' || session.state === 'CLOSED') {
                  send(clientWs, { type: 'call_ended' });
                  await cleanup();
                  return;
                }
              }

              // Synthesize & stream agent reply
              if (fullText.trim() && ELEVEN_KEY && !abort.signal.aborted) {
                await synthesize(config.CR_VOICE_EN, fullText, (chunk) => {
                  if (!abort.signal.aborted) {
                    send(clientWs, { type: 'audio', data: chunk.toString('base64') });
                  }
                }, abort.signal).catch((err) => logger.warn(err, 'TTS error'));
                send(clientWs, { type: 'audio_done' });
              }

              state.turnAbort = null;
            },
            (errMsg) => send(clientWs, { type: 'error', message: errMsg }),
          );
        }

        // Forward raw PCM to Deepgram
        if (state.dgSocket?.readyState === WebSocket.OPEN) {
          const pcmBuf = Buffer.from(msg.data, 'base64');
          state.dgSocket.send(pcmBuf);
        }
        break;
      }

      // ── stop_audio ────────────────────────────────────────────────────────────
      case 'stop_audio': {
        // Signal Deepgram we're done sending — it will flush the final transcript
        if (state.dgSocket?.readyState === WebSocket.OPEN) {
          // Send a CloseStream message so Deepgram flushes pending transcript
          state.dgSocket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        state.dgSocket = null;
        break;
      }

      // ── end ───────────────────────────────────────────────────────────────────
      case 'end': {
        await cleanup();
        send(clientWs, { type: 'call_ended' });
        break;
      }
    }
  });

  clientWs.on('close', cleanup);
  clientWs.on('error', (err) => {
    logger.error(err, 'Test UI client WS error');
    cleanup();
  });
}

// ── Mount ──────────────────────────────────────────────────────────────────────

export function attachTestVoiceWS(httpServer: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/test/voice') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', handleConnection);
  logger.info('Test voice WebSocket attached at /test/voice');
  return wss;
}
