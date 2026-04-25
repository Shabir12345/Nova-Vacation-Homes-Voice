// Express server — Twilio voice webhooks with auth, rate limiting, and analytics

import express, { Request, Response, NextFunction } from 'express';
import { AgentOrchestrator } from './agent';
import { twilioWebhookAuth } from './middleware/twilio-auth';
import { voiceCallRateLimiter } from './middleware/rate-limiter';
import { Metrics } from './middleware/metrics';
import { AnalyticsService } from './services/analytics.service';
import { config } from './config';
import { logger } from './utils/logger';

export const createServer = (): express.Application => {
  const app = express();

  // Parse URL-encoded bodies (Twilio sends application/x-www-form-urlencoded)
  // Raw body must be preserved for signature validation
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Structured request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Request received');
    next();
  });

  // ── Health & observability ────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'nova-voice-agent',
      env: config.NODE_ENV,
      ts: new Date().toISOString(),
    });
  });

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
    } catch (err) {
      logger.error(err, 'Analytics fetch failed');
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // ── Twilio: Incoming call ─────────────────────────────────────────────────
  // Rate limit → signature auth → handler
  app.post(
    '/voice/incoming',
    voiceCallRateLimiter,
    twilioWebhookAuth,
    async (req: Request, res: Response) => {
      const callSid = req.body.CallSid as string;
      const from    = req.body.From    as string;

      Metrics.callStarted();

      try {
        await AgentOrchestrator.startSession(callSid, from);
        logger.info({ callSid, from }, 'Incoming call accepted');

        // Get the opening greeting line to embed in TwiML
        const greeting = await AgentOrchestrator.getGreeting(callSid);

        // TwiML: speak the greeting, then open the bidirectional audio stream
        const wsUrl = config.WEBSOCKET_URL ?? `wss://${req.hostname}/voice/stream`;

        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${escapeXml(greeting)}</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`);
      } catch (err) {
        logger.error({ callSid, err }, 'Failed to handle incoming call');
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, we're experiencing technical difficulties. Please try calling back in a few minutes.</Say>
  <Hangup/>
</Response>`);
      }
    }
  );

  // ── Twilio: Call status callback ──────────────────────────────────────────
  app.post(
    '/voice/status',
    twilioWebhookAuth,
    async (req: Request, res: Response) => {
      const callSid    = req.body.CallSid    as string;
      const callStatus = req.body.CallStatus as string;

      logger.info({ callSid, callStatus }, 'Call status update');

      if (['completed', 'failed', 'no-answer', 'busy'].includes(callStatus)) {
        const session = await AgentOrchestrator.getSession(callSid);
        if (session) {
          Metrics.callEnded(session.state);
          if (session.state === 'ESCALATED') {
            Metrics.callEscalated(session.escalationReason ?? 'unknown');
          }
        }
        AgentOrchestrator.endSession(callSid).catch((err) =>
          logger.warn(err, 'Failed to end session on status callback')
        );
      }

      res.sendStatus(204);
    }
  );

  // ── 404 & global error handler ────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};

// Escape characters that would break TwiML XML
const escapeXml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
