// Test UI server — browser-based agent testing without Twilio or a phone.
// Requires: ANTHROPIC_API_KEY (mandatory)
//           DEEPGRAM_API_KEY  (for real STT — falls back to browser speech if missing)
//           ELEVENLABS_API_KEY (for real TTS — falls back to browser synth if missing)
//
// Usage:
//   npm run test:ui
//   → open http://localhost:3001

import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import express, { Request, Response } from 'express';
import path from 'path';
import { AgentOrchestrator } from '../agent';
import { forceMemoryMode } from '../utils/session-store';
import { attachTestVoiceWS } from './voice-ws';
import { logger } from '../utils/logger';

const app = express();
app.use(express.json());

// Serve the test UI static files from /public
app.use(express.static(path.join(__dirname, '../../public')));

// ── REST fallback endpoints (used by text-only mode) ──────────────────────────

// POST /api/start — create a new session, return sessionId + opening greeting
app.post('/api/start', async (_req: Request, res: Response) => {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await AgentOrchestrator.startSession(sessionId, 'browser-test');
    const greeting = await AgentOrchestrator.getGreeting(sessionId);
    res.json({ sessionId, greeting });
  } catch (err) {
    logger.error(err, 'Failed to start test session');
    res.status(500).json({ error: 'Failed to start session — check ANTHROPIC_API_KEY' });
  }
});

// POST /api/message — process one user turn, return agent response + call state
app.post('/api/message', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as { sessionId?: string; message?: string };

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required' });
    return;
  }

  try {
    const result = await AgentOrchestrator.handleMessage(sessionId, message);
    res.json({
      response:  result.agentResponse,
      state:     result.context.state,
      escalated: result.escalated,
      topIntent: result.context.topIntent,
      language:  result.context.language,
    });
  } catch (err) {
    logger.error(err, 'Test message failed');
    res.status(500).json({ error: 'Agent error — see server logs' });
  }
});

// POST /api/end — finalise and clean up the session
app.post('/api/end', async (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) {
    await AgentOrchestrator.endSession(sessionId).catch(() => undefined);
  }
  res.json({ ok: true });
});

// ── Boot ───────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.TEST_UI_PORT ?? '3001', 10);

(async () => {
  forceMemoryMode(); // skip Redis — sessions live in-memory for the test server

  // Create a plain HTTP server so we can attach WebSocket upgrades alongside HTTP
  const httpServer = http.createServer(app);

  // Mount the voice WebSocket at ws://localhost:PORT/test/voice
  attachTestVoiceWS(httpServer);

  httpServer.listen(PORT, () => {
    const hasDG     = !!process.env.DEEPGRAM_API_KEY;
    const hasEleven = !!process.env.ELEVENLABS_API_KEY;

    console.log('\n' + '─'.repeat(52));
    console.log('  Nova Voice Agent  ·  Browser Test Lab');
    console.log(`  http://localhost:${PORT}`);
    console.log('─'.repeat(52));
    console.log(`  STT  : ${hasDG     ? '✓ Deepgram (real)'      : '⚠ Browser Web Speech (set DEEPGRAM_API_KEY)'}`);
    console.log(`  TTS  : ${hasEleven ? '✓ ElevenLabs (real)'    : '⚠ Browser synth (set ELEVENLABS_API_KEY)'}`);
    console.log(`  Agent: ✓ Claude (ANTHROPIC_API_KEY present)`);
    console.log('─'.repeat(52) + '\n');
  });
})().catch((err) => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});
