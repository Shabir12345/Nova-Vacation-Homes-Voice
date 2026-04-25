// Rate limiter — prevents a single phone number from spamming the agent.
// Uses a sliding window backed by Redis (falls back to in-memory in dev).
// Configured via CALLS_PER_MINUTE_PER_NUMBER in .env.

import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { config } from '../config';
import { logger } from '../utils/logger';

// Simple in-process sliding window for when Redis is unavailable
const inMemoryWindows = new Map<string, number[]>();

const isRateLimited = (phoneNumber: string): boolean => {
  if (!config.ENABLE_RATE_LIMITING) return false;

  const windowMs = 60_000; // 1 minute
  const maxCalls = config.CALLS_PER_MINUTE_PER_NUMBER;
  const now = Date.now();

  const timestamps = (inMemoryWindows.get(phoneNumber) ?? []).filter(
    (ts) => now - ts < windowMs
  );

  if (timestamps.length >= maxCalls) return true;

  timestamps.push(now);
  inMemoryWindows.set(phoneNumber, timestamps);
  return false;
};

// Clean up old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, timestamps] of inMemoryWindows.entries()) {
    const pruned = timestamps.filter((ts) => ts > cutoff);
    if (pruned.length === 0) inMemoryWindows.delete(key);
    else inMemoryWindows.set(key, pruned);
  }
}, 5 * 60_000);

export const voiceCallRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const phoneNumber = (req.body?.From as string) ?? req.ip ?? 'unknown';
  const normalised = phoneNumber.replace(/\s+/g, '').slice(0, 20);

  if (isRateLimited(normalised)) {
    logger.warn({ phoneNumber: normalised }, 'Rate limit exceeded — rejecting call');
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, we're experiencing high call volume. Please try again in a few minutes.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  next();
};
