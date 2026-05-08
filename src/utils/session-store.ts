// Distributed session store backed by Redis.
// Falls back to an in-memory Map in development when Redis is unavailable.
// Sessions are TTL'd at 2 hours — well beyond any real call duration.

import { createClient, RedisClientType } from 'redis';
import { ConversationContext } from '../agent/state-machine';
import { config } from '../config';
import { logger } from './logger';

const SESSION_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const KEY_PREFIX = 'nova:session:';
const CACHE_PREFIX = 'nova:cache:';

let redisClient: RedisClientType | null = null;
const memoryFallback = new Map<string, string>();
// Cache fallback stores value + expiry epoch ms so the in-memory mode honours TTL
const cacheMemoryFallback = new Map<string, { value: string; expiresAt: number }>();
let usingFallback = false;

export const initializeSessionStore = async (): Promise<void> => {
  try {
    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          // In development, fail fast so we use the in-memory fallback
          if (config.NODE_ENV === 'development' && retries > 0) {
            return new Error('Redis connection failed');
          }
          // Otherwise retry with exponential backoff (capped at 3s)
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 2000,
      }
    }) as RedisClientType;

    redisClient.on('error', (err) => {
      // Only log if we aren't using the fallback already
      if (!usingFallback) {
        logger.error(err, 'Redis error');
      }
    });

    redisClient.on('reconnecting', () => {
      if (!usingFallback) {
        logger.warn('Redis reconnecting...');
      }
    });

    await redisClient.connect();
    logger.info('Redis session store connected');
  } catch (err) {
    if (config.NODE_ENV === 'production') {
      throw new Error(`Redis connection failed in production — cannot start without session store: ${err}`);
    }
    logger.warn(err, 'Redis unavailable — falling back to in-memory session store (not suitable for production)');
    usingFallback = true;
    redisClient = null;
  }
};

// Force in-memory mode immediately — used by the test UI server to skip Redis entirely
export const forceMemoryMode = (): void => {
  usingFallback = true;
  redisClient = null;
};

export const closeSessionStore = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis session store closed');
  }
};

export const SessionStore = {
  get: async (callId: string): Promise<ConversationContext | null> => {
    const key = KEY_PREFIX + callId;

    if (usingFallback) {
      const raw = memoryFallback.get(key);
      return raw ? (JSON.parse(raw) as ConversationContext) : null;
    }

    const raw = await redisClient!.get(key);
    if (!raw) return null;

    const ctx = JSON.parse(raw) as ConversationContext;
    // Rehydrate Date object (JSON serialises it to string)
    ctx.startedAt = new Date(ctx.startedAt);
    return ctx;
  },

  set: async (callId: string, ctx: ConversationContext): Promise<void> => {
    const key = KEY_PREFIX + callId;
    const raw = JSON.stringify(ctx);

    if (usingFallback) {
      memoryFallback.set(key, raw);
      return;
    }

    await redisClient!.setEx(key, SESSION_TTL_SECONDS, raw);
  },

  delete: async (callId: string): Promise<void> => {
    const key = KEY_PREFIX + callId;

    if (usingFallback) {
      memoryFallback.delete(key);
      return;
    }

    await redisClient!.del(key);
  },

  // List all active sessions (for monitoring / graceful shutdown)
  keys: async (): Promise<string[]> => {
    if (usingFallback) {
      return [...memoryFallback.keys()].map((k) => k.replace(KEY_PREFIX, ''));
    }
    const keys = await redisClient!.keys(`${KEY_PREFIX}*`);
    return keys.map((k) => k.replace(KEY_PREFIX, ''));
  },
};

// ─── Generic short-TTL cache ──────────────────────────────────────────────────
// Used by read-heavy tool lookups (listing info, check-in info, etc.) where the
// same reservation_id gets queried multiple times within a single call. Keep
// TTLs short (≤120s) so we never serve stale data to a guest.

export const Cache = {
  get: async <T>(key: string): Promise<T | null> => {
    const k = CACHE_PREFIX + key;

    if (usingFallback) {
      const entry = cacheMemoryFallback.get(k);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        cacheMemoryFallback.delete(k);
        return null;
      }
      return JSON.parse(entry.value) as T;
    }

    const raw = await redisClient!.get(k);
    return raw ? (JSON.parse(raw) as T) : null;
  },

  set: async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
    const k = CACHE_PREFIX + key;
    const raw = JSON.stringify(value);

    if (usingFallback) {
      cacheMemoryFallback.set(k, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
      return;
    }

    await redisClient!.setEx(k, ttlSeconds, raw);
  },
};
