import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { initializeDatabase } from './db/connection';
import { initializeClientDb } from './services/client-db.service';
import { createServer } from './server';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

async function bootstrap(): Promise<void> {
  try {
    logger.info(`Starting Nova Vacation Homes Voice Agent (${NODE_ENV})`);

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }

    await initializeDatabase();
    logger.info('Our database connected');

    initializeClientDb(); // Non-fatal if CLIENT_DATABASE_URL not set yet
    logger.info('Client database adapter initialised');

    const app = createServer();
    app.listen(PORT, () => {
      logger.info(`HTTP server listening on port ${PORT}`);
      logger.info('Ready to accept Twilio webhook calls');
    });
  } catch (error) {
    logger.error(error, 'Bootstrap failed');
    process.exit(1);
  }
}

bootstrap();
