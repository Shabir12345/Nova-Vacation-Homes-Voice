// Express server — Twilio voice webhooks with auth, rate limiting, and analytics

import express, { Request, Response, NextFunction } from 'express';
import { AgentOrchestrator } from './agent';
import { twilioWebhookAuth } from './middleware/twilio-auth';
import { voiceCallRateLimiter } from './middleware/rate-limiter';
import { Metrics } from './middleware/metrics';
import { notFoundHandler, globalErrorHandler } from './middleware/error-handler';
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
  `${voiceId}-${config.CR_VOICE_SPEED}_${config.CR_VOICE_STABILITY}_${config.CR_VOICE_SIMILARITY}`;
