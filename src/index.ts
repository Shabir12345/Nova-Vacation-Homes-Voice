import { config } from './config'; // validates env vars first — fails fast
import { logger } from './utils/logger';
import { initializeDatabase, runMigrations, closeDatabase } from './db/connection';
import { initializeClientDb } from './services/client-db.service';
import { initializeSessionStore, closeSessionStore } from './utils/session-store';
import { AgentOrchestrator } from './agent';
import { createServer } from './server';
import { attachConversationRelay } from './voice/conversation-relay';
import http from 'http';

async function bootstrap(): Promise<void> {
  logger.info({ env: config.NODE_ENV, port: config.PORT }, 'Starting Nova Vacation Homes Voice Agent');

  await initializeDatabase();
  await runMigrations();
  logger.info('Our database ready');

  await initializeSessionStore();
  logger.info('Session store ready');

  initializeClientDb(); // non-fatal — degrades gracefully without CLIENT_DATABASE_URL
  logger.info('Client DB adapter initialised');

  const app = createServer();
  const server = http.createServer(app);

  // Mount the ConversationRelay WebSocket on the same HTTP server at /voice/relay
  const wss = attachConversationRelay(server);

  await new Promise<void>((resolve) => {
    server.listen(config.PORT, resolve);
  });

  logger.info(`HTTP server listening on :${config.PORT}`);
  logger.info('Ready to accept calls');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    // Stop accepting new connections
    wss.close(() => logger.info('WebSocket server closed'));
    server.close(() => logger.info('HTTP server closed'));

    // Drain in-flight calls (up to 30s)
    await AgentOrchestrator.drainActiveCalls(30_000);

    // Close database connections
    await closeDatabase();
    await closeSessionStore();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // Log unhandled rejections instead of crashing silently
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

bootstrap().catch((err) => {
  logger.error(err, 'Bootstrap failed');
  process.exit(1);
});
