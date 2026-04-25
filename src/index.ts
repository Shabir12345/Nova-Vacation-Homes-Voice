import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { initializeDatabase } from './db/connection';

dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function bootstrap(): Promise<void> {
  try {
    logger.info(`Starting Nova Vacation Homes Voice Agent (${NODE_ENV})`);

    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // TODO: Initialize Redis connection
    // TODO: Initialize Express server
    // TODO: Register voice API webhooks
    // TODO: Initialize agent orchestrator

    logger.info(`Server running on port ${PORT}`);
    logger.info('Bootstrap complete');
  } catch (error) {
    logger.error(error, 'Bootstrap failed');
    process.exit(1);
  }
}

bootstrap();
