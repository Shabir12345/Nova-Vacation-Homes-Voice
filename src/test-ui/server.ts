// Test UI server — browser-based agent testing without Twilio or a database.
// Only ANTHROPIC_API_KEY is required.
//
// Usage:
//   npm run test:ui
//   → open http://localhost:3001

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import { AgentOrchestrator } from '../agent';
import { forceMemoryMode } from '../utils/session-store';
import { logger } from '../utils/logger';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

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
      response:   result.agentResponse,
      state:      result.context.state,
      escalated:  result.escalated,
      topIntent:  result.context.topIntent,
      language:   result.context.language,
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

const PORT = parseInt(process.env.TEST_UI_PORT ?? '3001', 10);

(async () => {
  forceMemoryMode(); // skip Redis entirely — sessions live in-memory for this test server
  app.listen(PORT, () => {
    console.log('\n' + '─'.repeat(42));
    console.log('  Nova Voice Agent  ·  Browser Test UI');
    console.log(`  http://localhost:${PORT}`);
    console.log('─'.repeat(42) + '\n');
  });
})().catch((err) => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});
