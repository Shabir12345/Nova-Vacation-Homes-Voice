import 'dotenv/config';
import { runMigrations } from '../src/db/connection';
import { logger } from '../src/utils/logger';

(async () => {
  try {
    logger.info('Starting database migrations...');
    await runMigrations();
    logger.info('✅ Database migrations finished.');
    process.exit(0);
  } catch (err) {
    logger.error(err, '❌ Database migration failed');
    process.exit(1);
  }
})();
