// Twilio webhook signature validation — prevents fake calls from hitting the agent.
// Twilio signs every request with HMAC-SHA1 using your auth token.
// If the signature doesn't match, we reject the request immediately.

import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { config } from '../config';
import { logger } from '../utils/logger';

export const twilioWebhookAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Skip validation in development or when auth token is not configured
  if (!config.ENABLE_TWILIO_VALIDATION || !config.TWILIO_AUTH_TOKEN) {
    next();
    return;
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;

  if (!twilioSignature) {
    logger.warn({ path: req.path, ip: req.ip }, 'Missing Twilio signature — rejecting request');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Build the full URL as Twilio sees it (must match exactly)
  const protocol = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;

  const isValid = twilio.validateRequest(
    config.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    req.body as Record<string, string>
  );

  if (!isValid) {
    logger.warn({ path: req.path, url, ip: req.ip }, 'Invalid Twilio signature — rejecting request');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
};
