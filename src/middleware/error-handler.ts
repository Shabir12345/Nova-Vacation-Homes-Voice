// Error handling middleware and utilities

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
