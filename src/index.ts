import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { initializeDatabase } from './db/connection';
import { AgentOrchestrator } from './agent';

dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function bootstrap(): Promise<void> {
  try {
    logger.info(`Starting Nova Vacation Homes Voice Agent (${NODE_ENV})`);

    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // Verify agent can start (Anthropic key check)
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }
    logger.info('Agent ready');

    // TODO: Initialize Redis connection
    // TODO: Initialize Express server with voice webhooks (Phase 6)

    logger.info(`Server running on port ${PORT}`);
    logger.info('Bootstrap complete');
  } catch (error) {
    logger.error(error, 'Bootstrap failed');
    process.exit(1);
  }
}

// Exported for use in voice webhook handlers
export { AgentOrchestrator };

bootstrap();
