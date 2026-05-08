// Error handling middleware and utilities

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const handleError = (error: unknown): void => {
  if (error instanceof AppError) {
    logger.error({ error: error.code }, error.message);
  } else if (error instanceof Error) {
    logger.error(error, 'Unexpected error');
  } else {
    logger.error('Unknown error');
  }
};

// Twilio webhook routes need TwiML back, not JSON — otherwise Twilio retries the call
const isTwilioRoute = (req: Request): boolean => req.path.startsWith('/voice');

const twimlError = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, something went wrong. Please try your call again in a moment.</Say>
  <Hangup/>
</Response>`;

// 404 handler — must be registered before the error handler
export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};

// Global Express error handler (4-arg signature is required by Express)
export const globalErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const status = err instanceof AppError ? err.statusCode : 500;
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  if (isTwilioRoute(req)) {
    res.status(200).type('text/xml').send(twimlError);
  } else {
    res.status(status).json({ error: err instanceof AppError ? err.message : 'Internal server error' });
  }
};
