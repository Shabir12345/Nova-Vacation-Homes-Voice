// Express server — Twilio voice webhooks with auth, rate limiting, and analytics

import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { AgentOrchestrator } from './agent';
import { twilioWebhookAuth } from './middleware/twilio-auth';
import { voiceCallRateLimiter } from './middleware/rate-limiter';
import { Metrics } from './middleware/metrics';
import { notFoundHandler, globalErrorHandler } from './middleware/error-handler';
import { AnalyticsService } from './services/analytics.service';
import { getPool } from './db/connection';
import { config } from './config';
import { logger } from './utils/logger';

export const createServer = (): express.Application => {
  const app = express();

  // Parse URL-encoded bodies (Twilio sends application/x-www-form-urlencoded)
  // Raw body must be preserved for signature validation
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // CORS for dashboard dev
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    next();
  });

  // Structured request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Request received');
    next();
  });

  // Serve dashboard static files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
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
      return res.json({ summary, daily, escalations });
    } catch (err) {
      logger.error(err, 'Analytics fetch failed');
      return res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // ── Dashboard API ─────────────────────────────────────────────────────────

  // GET /api/dashboard/analytics?days=30
  app.get('/api/dashboard/analytics', async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const [summary, daily, escalations, intents] = await Promise.all([
        AnalyticsService.getSummary(days),
        AnalyticsService.getDailyStats(days),
        AnalyticsService.getTopEscalationReasons(days),
        AnalyticsService.getIntentBreakdown(days),
      ]);
      return res.json({ summary, daily, escalations, intents });
    } catch (err) {
      logger.error(err, 'Dashboard analytics fetch failed');
      return res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // GET /api/dashboard/calls?page=1&limit=20&intent=&escalated=
  app.get('/api/dashboard/calls', async (req: Request, res: Response) => {
    try {
      const page   = Math.max(1, parseInt(req.query.page   as string) || 1);
      const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
      const offset = (page - 1) * limit;
      const intent    = req.query.intent    as string | undefined;
      const escalated = req.query.escalated as string | undefined;

      let where = 'WHERE 1=1';
      const params: unknown[] = [];
      if (intent)    { params.push(intent);    where += ` AND intent = $${params.length}`; }
      if (escalated !== undefined && escalated !== '') {
        params.push(escalated === 'true');
        where += ` AND escalated = $${params.length}`;
      }

      const countResult = await getPool().query(
        `SELECT COUNT(*) FROM call_logs ${where}`, params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      params.push(limit);  const limitIdx  = params.length;
      params.push(offset); const offsetIdx = params.length;
      const result = await getPool().query(
        `SELECT call_id, phone_number, intent, duration_seconds, escalated,
                escalation_reason, booking_id, created_at, ended_at
         FROM call_logs ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );

      return res.json({ calls: result.rows, total, page, limit });
    } catch (err) {
      logger.error(err, 'Dashboard calls fetch failed');
      return res.status(500).json({ error: 'Failed to fetch calls' });
    }
  });

  // GET /api/dashboard/calls/:callId/transcript
  app.get('/api/dashboard/calls/:callId/transcript', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const [callResult, transcriptResult] = await Promise.all([
        getPool().query('SELECT * FROM call_logs WHERE call_id = $1', [callId]),
        getPool().query(
          `SELECT role, message, tool_called, tool_params, tool_result, created_at
           FROM agent_interactions WHERE call_id = $1 ORDER BY created_at ASC`,
          [callId]
        ),
      ]);
      if (callResult.rows.length === 0) {
        return res.status(404).json({ error: 'Call not found' });
      }
      return res.json({ call: callResult.rows[0], interactions: transcriptResult.rows });
    } catch (err) {
      logger.error(err, 'Transcript fetch failed');
      return res.status(500).json({ error: 'Failed to fetch transcript' });
    }
  });

  // GET /api/dashboard/intake?status=pending&type=
  app.get('/api/dashboard/intake', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const type   = req.query.type   as string | undefined;
      let where = 'WHERE 1=1';
      const params: unknown[] = [];
      if (status) { params.push(status); where += ` AND status = $${params.length}`; }
      if (type)   { params.push(type);   where += ` AND intake_type = $${params.length}`; }
      const result = await getPool().query(
        `SELECT * FROM intake_messages ${where} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.json({ items: result.rows });
    } catch (err) {
      logger.error(err, 'Intake fetch failed');
      return res.status(500).json({ error: 'Failed to fetch intake messages' });
    }
  });

  // GET /api/dashboard/service-requests?status=&urgency=
  app.get('/api/dashboard/service-requests', async (req: Request, res: Response) => {
    try {
      const status  = req.query.status  as string | undefined;
      const urgency = req.query.urgency as string | undefined;
      let where = 'WHERE 1=1';
      const params: unknown[] = [];
      if (status)  { params.push(status);  where += ` AND status = $${params.length}`; }
      if (urgency) { params.push(urgency); where += ` AND urgency = $${params.length}`; }
      const result = await getPool().query(
        `SELECT * FROM service_requests ${where} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.json({ items: result.rows });
    } catch (err) {
      logger.error(err, 'Service requests fetch failed');
      return res.status(500).json({ error: 'Failed to fetch service requests' });
    }
  });

  // PATCH /api/dashboard/intake/:id — update status / assignment
  app.patch('/api/dashboard/intake/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, assigned_to } = req.body as { status?: string; assigned_to?: string };
      const result = await getPool().query(
        `UPDATE intake_messages SET
           status      = COALESCE($1, status),
           assigned_to = COALESCE($2, assigned_to),
           resolved_at = CASE WHEN $1 = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
           updated_at  = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [status ?? null, assigned_to ?? null, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ item: result.rows[0] });
    } catch (err) {
      logger.error(err, 'Intake update failed');
      return res.status(500).json({ error: 'Failed to update intake message' });
    }
  });

  // GET /api/dashboard/voice-config — read current voice agent settings
  app.get('/api/dashboard/voice-config', (_req: Request, res: Response) => {
    res.json({
      ttsProvider:       config.CR_TTS_PROVIDER,
      voiceEn:           config.CR_VOICE_EN,
      voiceEs:           config.CR_VOICE_ES,
      voicePt:           config.CR_VOICE_PT,
      speed:             config.CR_VOICE_SPEED,
      stability:         config.CR_VOICE_STABILITY,
      similarity:        config.CR_VOICE_SIMILARITY,
      interruptSensitivity: config.CR_INTERRUPT_SENSITIVITY,
      eotThreshold:      config.CR_EOT_THRESHOLD,
      speechModel:       config.CR_SPEECH_MODEL,
      transcriptionProvider: config.CR_TRANSCRIPTION_PROVIDER,
      businessHoursOpen:  config.BUSINESS_HOURS_OPEN,
      businessHoursClose: config.BUSINESS_HOURS_CLOSE,
      businessTimezone:   config.BUSINESS_TIMEZONE,
    });
  });

  // ── Feedback API ─────────────────────────────────────────────────────────

  // GET /api/dashboard/feedback
  app.get('/api/dashboard/feedback', async (_req: Request, res: Response) => {
    try {
      const result = await getPool().query(
        'SELECT * FROM client_feedback ORDER BY created_at DESC'
      );
      return res.json({ items: result.rows });
    } catch (err) {
      logger.error(err, 'Feedback fetch failed');
      return res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  });

  // POST /api/dashboard/feedback
  app.post('/api/dashboard/feedback', async (req: Request, res: Response) => {
    try {
      const { title, description, priority } = req.body;
      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required' });
      }
      const result = await getPool().query(
        `INSERT INTO client_feedback (title, description, priority, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING *`,
        [title, description, priority || 'medium']
      );
      return res.status(201).json({ item: result.rows[0] });
    } catch (err) {
      logger.error(err, 'Feedback creation failed');
      return res.status(500).json({ error: 'Failed to create feedback' });
    }
  });

  // PATCH /api/dashboard/feedback/:id
  app.patch('/api/dashboard/feedback/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, priority } = req.body;
      const result = await getPool().query(
        `UPDATE client_feedback SET
           status = COALESCE($1, status),
           priority = COALESCE($2, priority),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [status ?? null, priority ?? null, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      return res.json({ item: result.rows[0] });
    } catch (err) {
      logger.error(err, 'Feedback update failed');
      return res.status(500).json({ error: 'Failed to update feedback' });
    }
  });

  // ── Twilio: Incoming call ─────────────────────────────────────────────────
  // Rate limit → signature auth → handler.
  // Returns TwiML that hands the call to ConversationRelay — Twilio handles
  // STT (Deepgram Nova-3), TTS (ElevenLabs), turn detection, and barge-in.
  // Our WebSocket at /voice/relay only receives transcribed prompts and
  // streams Claude tokens back as text.
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

        const greeting = await AgentOrchestrator.getGreeting(callSid);
        const wsUrl = config.PUBLIC_WSS_URL ?? `wss://${req.hostname}/voice/relay`;

        const voiceEn = tunedVoice(config.CR_VOICE_EN);
        const voiceEs = tunedVoice(config.CR_VOICE_ES);
        const voicePt = tunedVoice(config.CR_VOICE_PT);

        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${escapeXml(greeting)}"
      welcomeGreetingInterruptible="speech"
      ttsProvider="${config.CR_TTS_PROVIDER}"
      voice="${voiceEn}"
      transcriptionProvider="${config.CR_TRANSCRIPTION_PROVIDER}"
      speechModel="${config.CR_SPEECH_MODEL}"
      language="en-US"
      interruptible="any"
      interruptSensitivity="${config.CR_INTERRUPT_SENSITIVITY}"
      eotThreshold="${config.CR_EOT_THRESHOLD}"
      partialPrompts="false"
      reportInputDuringAgentSpeech="speech"
      elevenlabsTextNormalization="auto">
      <Language code="es-US" voice="${voiceEs}" />
      <Language code="pt-BR" voice="${voicePt}" />
      <Parameter name="callSid" value="${callSid}" />
    </ConversationRelay>
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
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

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

// ElevenLabs voice tuning suffix — Twilio ConversationRelay format:
// "VOICE_ID-SPEED_STABILITY_SIMILARITY". See:
// https://www.twilio.com/docs/voice/conversationrelay/voice-configuration
const tunedVoice = (voiceId: string): string =>
  `${voiceId}-${config.CR_VOICE_SPEED.toFixed(1)}_${config.CR_VOICE_STABILITY.toFixed(2)}_${config.CR_VOICE_SIMILARITY.toFixed(2)}`;
