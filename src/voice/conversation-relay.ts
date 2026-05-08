// WebSocket handler for Twilio ConversationRelay.
//
// Twilio handles STT (Deepgram Nova-3), TTS (ElevenLabs), VAD, turn detection,
// and barge-in. We just receive transcribed prompts and stream back text tokens
// for Twilio's TTS engine to speak. End-to-end latency stays under 800ms because
// (a) we stream Claude tokens as they generate, and (b) ElevenLabs Flash starts
// speaking on the first token.
//
// Protocol — messages we receive:
//   { type: 'setup',     callSid, sessionId, from, to, customParameters }
//   { type: 'prompt',    voicePrompt, lang, last }
//   { type: 'interrupt', utteranceUntilInterrupt, durationUntilInterruptMs }
//   { type: 'dtmf',      digit }
//   { type: 'error',     description }
//
// Messages we send:
//   { type: 'text',     token, last, lang?, interruptible?, preemptible? }
//   { type: 'language', ttsLanguage, transcriptionLanguage }
//   { type: 'play',     source, loop?, interruptible? }
//   { type: 'end',      handoffData? }

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server as HttpServer } from 'http';
import { AgentOrchestrator } from '../agent';
import { Language } from '../agent/state-machine';
import { logger } from '../utils/logger';
import { config } from '../config';

// ─── Twilio message types ─────────────────────────────────────────────────────

interface SetupMessage {
  type: 'setup';
  sessionId: string;
  callSid: string;
  from: string;
  to: string;
  customParameters?: Record<string, string>;
}

interface PromptMessage {
  type: 'prompt';
  voicePrompt: string;
  lang: string;
  last: boolean;
}

interface InterruptMessage {
  type: 'interrupt';
  utteranceUntilInterrupt: string;
  durationUntilInterruptMs: number;
}

interface DtmfMessage {
  type: 'dtmf';
  digit: string;
}

interface ErrorMessage {
  type: 'error';
  description: string;
}

type IncomingMessage_ =
  | SetupMessage | PromptMessage | InterruptMessage | DtmfMessage | ErrorMessage;

// ─── Per-call state ───────────────────────────────────────────────────────────

interface CallState {
  callSid: string;
  language: Language;
  // AbortController fires when the caller interrupts the agent mid-reply.
  // Aborting ends the Claude stream so we don't keep generating tokens nobody
  // will hear.
  currentTurn: AbortController | null;
  // Filler timer — fires if a tool call takes >FILLER_DELAY_MS so we can speak
  // a short "let me check that" instead of going silent.
  fillerTimer: NodeJS.Timeout | null;
  // Last filler index used per language — avoids picking the same phrase twice
  // in a row, which is one of the strongest "this is a robot" tells.
  lastFillerIdx: number;
}

// Threshold for breaking dead air. Research on natural-sounding voice agents
// flags >700ms of silence as the line where realism collapses, so we kick a
// bridge phrase in just under that.
const FILLER_DELAY_MS = 600;

// Filler utterances spoken if a tool call runs slow. Variety + em-dashes/ellipses
// help these read naturally through ElevenLabs (no SSML available, so punctuation
// is the only prosody control). Mix lengths so consecutive turns don't sound
// patterned.
const FILLER_PHRASES: Record<Language, string[]> = {
  en: [
    'One sec — let me pull that up.',
    'Okay, checking that for you…',
    'Mm-hm, looking now…',
    'Just a moment — almost there.',
    'Let me see…',
    'Right, give me a second.',
    'Hmm, let me check that.',
    'Hang on — pulling it up.',
    'Yeah, one moment…',
    'Gotcha — looking that up.',
  ],
  es: [
    'Un momento — déjeme revisar.',
    'Permítame verificar eso…',
    'Un segundo, por favor.',
    'Mmm, lo estoy buscando ahora…',
    'Claro, deme un momentito.',
    'A ver… un momentito.',
    'Sí, un segundo — ya casi.',
    'Déjeme revisar eso rápido.',
  ],
  pt: [
    'Um momento — vou verificar.',
    'Só um instante…',
    'Tô checando isso pra você agora.',
    'Mmm, deixe-me ver…',
    'Claro, só um segundinho.',
    'Aguenta um pouquinho — quase lá.',
    'Tá, deixa eu olhar isso.',
    'Sim — um segundo, por favor.',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const send = (ws: WebSocket, msg: object): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

// Twilio's TTS prefers natural-sized chunks (a phrase or sentence) over per-character
// streaming. We buffer Claude's deltas at sentence boundaries so ElevenLabs can shape
// prosody correctly.
const SENTENCE_BREAK = /([.!?,…])\s+/;

const sendText = (ws: WebSocket, token: string, last: boolean, lang: string): void => {
  send(ws, { type: 'text', token, last, lang, interruptible: true, preemptible: false });
};

const langToBcp47 = (lang: Language): string =>
  lang === 'es' ? 'es-US' : lang === 'pt' ? 'pt-BR' : 'en-US';

// Pick a filler that's not the one we just used. Repeating "Mm-hm, looking
// now…" on back-to-back tool calls reads as scripted, even with a warm voice.
const pickFiller = (lang: Language, lastIdx: number): { text: string; idx: number } => {
  const phrases = FILLER_PHRASES[lang];
  if (phrases.length <= 1) return { text: phrases[0]!, idx: 0 };
  let idx = Math.floor(Math.random() * phrases.length);
  if (idx === lastIdx) idx = (idx + 1) % phrases.length;
  return { text: phrases[idx]!, idx };
};

// ─── Per-message handlers ────────────────────────────────────────────────────

const handlePrompt = async (
  ws: WebSocket,
  state: CallState,
  msg: PromptMessage
): Promise<void> => {
  if (!msg.last) return; // wait for the final transcript chunk
  if (!msg.voicePrompt?.trim()) return;

  // Cancel any in-flight turn first (defensive — interrupt should have done this)
  state.currentTurn?.abort();
  // Hold a local reference: handleInterrupt() may null state.currentTurn mid-stream,
  // and we still need .signal in the loop below to detect the abort cleanly instead
  // of crashing with "Cannot read properties of null (reading 'signal')".
  const turn = new AbortController();
  state.currentTurn = turn;

  logger.info({ callSid: state.callSid, prompt: msg.voicePrompt, lang: msg.lang }, 'Caller said');

  let buffer = '';
  const lang = langToBcp47(state.language);

  try {
    for await (const event of AgentOrchestrator.handleMessageStream(
      state.callSid,
      msg.voicePrompt,
      turn.signal
    )) {
      if (turn.signal.aborted) break;

      switch (event.type) {
        case 'token': {
          if (!event.text) break;
          buffer += event.text;
          // Flush at sentence boundaries so ElevenLabs gets phrase-shaped chunks
          const match = buffer.match(SENTENCE_BREAK);
          if (match) {
            const splitAt = (match.index ?? 0) + match[0].length;
            const phrase = buffer.slice(0, splitAt);
            buffer = buffer.slice(splitAt);
            sendText(ws, phrase, false, lang);
          }
          break;
        }

        case 'tool_start': {
          // Flush any bridge text the agent wrote before calling the tool.
          // Without this, the sentence buffer holds the bridge phrase until
          // whitespace follows — which never comes before a tool_start — so
          // the caller hears silence instead of "Sure, let me pull that up."
          if (buffer.trim()) {
            sendText(ws, buffer, false, lang);
            buffer = '';
          }
          // Filler timer — if the tool takes >FILLER_DELAY_MS, speak a
          // bridging phrase so the line never goes completely silent.
          state.fillerTimer = setTimeout(() => {
            const { text: filler, idx } = pickFiller(state.language, state.lastFillerIdx);
            state.lastFillerIdx = idx;
            logger.debug({ callSid: state.callSid, filler }, 'Speaking filler during tool call');
            send(ws, {
              type: 'text', token: filler, last: true, lang,
              interruptible: true, preemptible: true,
            });
          }, FILLER_DELAY_MS);
          break;
        }

        case 'tool_done': {
          if (state.fillerTimer) {
            clearTimeout(state.fillerTimer);
            state.fillerTimer = null;
          }
          break;
        }

        case 'final': {
          // Flush whatever's left in the buffer with last:true
          if (buffer.trim()) sendText(ws, buffer, true, lang);
          else sendText(ws, '', true, lang);
          buffer = '';
          break;
        }
      }
    }
  } catch (err) {
    logger.error({ err, callSid: state.callSid }, 'Error during turn');
    sendText(ws, "I'm having trouble — let me transfer you to someone.", true, lang);
  } finally {
    if (state.fillerTimer) {
      clearTimeout(state.fillerTimer);
      state.fillerTimer = null;
    }
    // Only clear if it's still ours — a newer prompt may have replaced it.
    if (state.currentTurn === turn) state.currentTurn = null;
  }
};

const handleInterrupt = (state: CallState, msg: InterruptMessage): void => {
  logger.info({
    callSid: state.callSid,
    cutAt: msg.utteranceUntilInterrupt,
    afterMs: msg.durationUntilInterruptMs,
  }, 'Caller interrupted');

  // Cancel the in-flight Claude generation so we stop producing tokens
  state.currentTurn?.abort();
  state.currentTurn = null;

  if (state.fillerTimer) {
    clearTimeout(state.fillerTimer);
    state.fillerTimer = null;
  }
};

// ─── WebSocket lifecycle ──────────────────────────────────────────────────────

const handleConnection = (ws: WebSocket, _req: IncomingMessage): void => {
  let state: CallState | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as IncomingMessage_;

      switch (msg.type) {
        case 'setup': {
          state = {
            callSid: msg.callSid,
            language: 'en',
            currentTurn: null,
            fillerTimer: null,
            lastFillerIdx: -1,
          };
          logger.info({ callSid: msg.callSid, from: msg.from }, 'ConversationRelay session opened');
          // Session is created by the /voice/incoming HTTP webhook, not here —
          // it already exists by the time the WS connects. If it doesn't, create it.
          const existing = await AgentOrchestrator.getSession(msg.callSid);
          if (!existing) {
            await AgentOrchestrator.startSession(msg.callSid, msg.from);
          }
          break;
        }

        case 'prompt': {
          if (!state) break;
          const session = await AgentOrchestrator.getSession(state.callSid);
          if (session && session.language !== state.language) {
            // Agent detected a language switch — tell Twilio to switch STT/TTS too
            state.language = session.language;
            send(ws, {
              type: 'language',
              ttsLanguage: langToBcp47(state.language),
              transcriptionLanguage: langToBcp47(state.language),
            });
            logger.info({ callSid: state.callSid, lang: state.language }, 'Switched language');
          }
          await handlePrompt(ws, state, msg);
          break;
        }

        case 'interrupt': {
          if (state) handleInterrupt(state, msg);
          break;
        }

        case 'dtmf': {
          if (state) logger.info({ callSid: state.callSid, digit: msg.digit }, 'DTMF received');
          break;
        }

        case 'error': {
          logger.error({ callSid: state?.callSid, description: msg.description }, 'ConversationRelay error');
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error handling ConversationRelay message');
    }
  });

  ws.on('close', async () => {
    if (state) {
      logger.info({ callSid: state.callSid }, 'ConversationRelay session closed');
      state.currentTurn?.abort();
      if (state.fillerTimer) clearTimeout(state.fillerTimer);
      await AgentOrchestrator.endSession(state.callSid).catch(() => undefined);
    }
  });

  ws.on('error', (err) => {
    logger.error({ err, callSid: state?.callSid }, 'ConversationRelay WebSocket error');
  });
};

// Mount the WebSocket handler at /voice/relay on an existing HTTP server,
// so Twilio reaches it over the same hostname as the /voice/incoming webhook.
export const attachConversationRelay = (httpServer: HttpServer): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/voice/relay') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', handleConnection);

  logger.info({ path: '/voice/relay', ttsProvider: config.CR_TTS_PROVIDER }, 'ConversationRelay WS attached');
  return wss;
};
