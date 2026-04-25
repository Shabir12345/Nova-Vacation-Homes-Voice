// Centralised, type-safe configuration
// Fails fast at startup with clear messages if anything required is missing.

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Our database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Client's read-only database (non-fatal — features degrade gracefully)
  CLIENT_DATABASE_URL: z.string().url().optional(),

  // Anthropic / Claude
  ANTHROPIC_API_KEY: z.string().min(10, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),

  // Redis — required for production
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  HUMAN_AGENT_PHONE: z.string().optional(),

  // WebSocket server for Twilio Media Streams
  WEBSOCKET_URL: z.string().optional(),

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
