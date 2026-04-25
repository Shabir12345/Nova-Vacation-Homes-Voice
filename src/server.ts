// Express server — handles Twilio voice webhooks and any REST routes

import express, { Request, Response, NextFunction } from 'express';
import { AgentOrchestrator } from './agent';
import { Metrics } from './middleware/metrics';
import { AnalyticsService } from './services/analytics.service';
import { logger } from './utils/logger';

export const createServer = (): express.Application => {
  const app = express();

  // Parse URL-encoded bodies (Twilio sends form data)
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'nova-voice-agent', ts: new Date().toISOString() });
  });

  // ── Metrics & Analytics ───────────────────────────────────────────────────
  app.get('/metrics', (_req: Request, res: Response) => {
    res.json(Metrics.snapshot());
  });

  app.get('/analytics', async (_req: Request, res: Response) => {
    try {
      const [summary, daily, escalations] = await Promise.all([
        AnalyticsService.getSummary(),
        AnalyticsService.getDailyStats(),
        AnalyticsService.getTopEscalationReasons(),
      ]);
      res.json({ summary, daily, escalations });
    } catch (error) {
      logger.error(error, 'Failed to fetch analytics');
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // ── Twilio: Incoming call ─────────────────────────────────────────────────
  // Twilio hits this URL when a call comes in. We respond with TwiML to
  // stream audio to our agent via <Connect><Stream>.
  app.post('/voice/incoming', async (req: Request, res: Response) => {
    const callSid = req.body.CallSid as string;
    const from = req.body.From as string;

    try {
      await AgentOrchestrator.startSession(callSid, from);
      logger.info({ callSid, from }, 'Incoming call received');

      // Return TwiML: connect audio stream to our WebSocket handler
      const wsUrl = process.env.WEBSOCKET_URL || `wss://${req.hostname}/voice/stream`;

      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`);
    } catch (error) {
      logger.error({ callSid, error }, 'Failed to handle incoming call');
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, we're experiencing technical difficulties. Please call back in a few minutes.</Say>
  <Hangup/>
</Response>`);
    }
  });

  // ── Twilio: Call status callback ──────────────────────────────────────────
  app.post('/voice/status', async (req: Request, res: Response) => {
    const callSid = req.body.CallSid as string;
    const callStatus = req.body.CallStatus as string;

    logger.info({ callSid, callStatus }, 'Call status update');

    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'no-answer') {
      await AgentOrchestrator.endSession(callSid).catch((err) =>
        logger.warn(err, 'Error ending session on status callback')
      );
    }

    res.sendStatus(204);
  });

  // ── Fallback for unknown routes ───────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};
