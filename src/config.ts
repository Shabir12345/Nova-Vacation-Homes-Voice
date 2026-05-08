// Centralised, type-safe configuration
// Fails fast at startup with clear messages if anything required is missing.

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Our database (required in production; optional so the test UI can start without one)
  DATABASE_URL: z.string().url().optional(),

  // Client's read-only database (non-fatal — features degrade gracefully)
  CLIENT_DATABASE_URL: z.string().url().optional(),

  // Anthropic / Claude
  ANTHROPIC_API_KEY: z.string().regex(/^sk-ant-/, 'ANTHROPIC_API_KEY must start with sk-ant-'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),

  // Redis — required for production
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  HUMAN_AGENT_PHONE: z.string().optional(),

  // Public WSS URL Twilio ConversationRelay connects to (e.g. wss://example.com/voice/relay)
  // In dev: ngrok or similar. In prod: your deployed hostname.
  PUBLIC_WSS_URL: z.string().optional(),

  // ConversationRelay voice config (ElevenLabs voice IDs)
  // Default voices chosen for warmth + multilingual support. Override per language.
  CR_TTS_PROVIDER: z.enum(['ElevenLabs', 'Google', 'Amazon']).default('ElevenLabs'),
  CR_VOICE_EN: z.string().default('FGY2WhTYpPnrIDTdsKH5'),  // ElevenLabs "Laura" — warm, conversational
  CR_VOICE_ES: z.string().default('Nh2zY9kknu6z4pZy6FhD'),  // ElevenLabs "David Martin" — Spanish
  CR_VOICE_PT: z.string().default('cyD08lEy76q03ER1jZ7y'),  // ElevenLabs Portuguese voice

  // ElevenLabs voice tuning — appended to the voice ID as "VOICE_ID-SPEED_STABILITY_SIMILARITY".
  // Defaults follow ElevenLabs' conversational guidance + voice-realism research:
  //   speed 0.98      — close to natural pace; tested as the sweet spot for a warm
  //                     receptionist on phone audio. 0.95 reads slightly slow over
  //                     Twilio; 1.0+ starts to feel bot-fast.
  //   stability 0.4   — "creative" range; lower value reduces TTS startup latency
  //                     while keeping emotional dynamics (>0.7 is monotone)
  //   similarity 0.75 — default; higher introduces artifacts
  CR_VOICE_SPEED:      z.coerce.number().min(0.7).max(1.2).default(0.98),
  CR_VOICE_STABILITY:  z.coerce.number().min(0.0).max(1.0).default(0.4),
  CR_VOICE_SIMILARITY: z.coerce.number().min(0.0).max(1.0).default(0.75),

  CR_TRANSCRIPTION_PROVIDER: z.enum(['Deepgram', 'Google']).default('Deepgram'),
  // nova-3-phonecall is trained on telephone audio (narrowband, noisy, accented speech).
  // Significantly better than nova-3-general for B/D/P/T confusion over phone lines.
  CR_SPEECH_MODEL: z.string().default('nova-3-phonecall'),
  // medium avoids false interrupts when callers pause between spelled letters or speak
  // with an accent — high fires too easily on ambient noise and short pauses.
  CR_INTERRUPT_SENSITIVITY: z.enum(['high', 'medium', 'low']).default('medium'),
  // 0.9 gives callers more time between spelled letters before the turn closes.
  // 0.8 was cutting off confirmation codes mid-spell.
  CR_EOT_THRESHOLD: z.coerce.number().min(0.5).max(1.0).default(0.9),

  // Business hours (24h, Eastern Time)
  BUSINESS_HOURS_OPEN: z.coerce.number().min(0).max(23).default(9),
  BUSINESS_HOURS_CLOSE: z.coerce.number().min(0).max(23).default(21),
  BUSINESS_TIMEZONE: z.string().default('America/New_York'),

  // Feature flags
  ENABLE_PROMPT_CACHING: z.coerce.boolean().default(true),
  ENABLE_TWILIO_VALIDATION: z.coerce.boolean().default(true),
  ENABLE_RATE_LIMITING: z.coerce.boolean().default(true),
  CALLS_PER_MINUTE_PER_NUMBER: z.coerce.number().default(3),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),

  // Staff notifications — Slack incoming webhook URL
  // Create at: https://api.slack.com/apps → Your App → Incoming Webhooks
  SLACK_WEBHOOK_URL: z.string().url().optional(),
});

type Config = z.infer<typeof configSchema>;

const parseConfig = (): Config => {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration errors:\n${errors}\n\nCheck your .env file.`);
  }

  return result.data;
};

// Singleton — parsed once at startup
export const config = parseConfig();

// Convenience helpers
export const isProd = (): boolean => config.NODE_ENV === 'production';
export const isDev = (): boolean => config.NODE_ENV === 'development';
