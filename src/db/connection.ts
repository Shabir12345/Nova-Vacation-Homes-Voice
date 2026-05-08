// PostgreSQL database connection setup

import { Pool, Client } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool;

export const initializeDatabase = async (): Promise<void> => {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
      connectionString: databaseUrl,
      // Voice traffic is low-concurrency (typically <5 simultaneous calls);
      // 10 leaves headroom without holding more PG connections than we need.
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW()');
      logger.info(`Database connected at ${result.rows[0].now}`);
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error(error, 'Failed to connect to database');
    throw error;
  }
};

export const getPool = (): Pool => {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializeDatabase() first.');
  }
  return pool;
};

export const closeDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    logger.info('Database connection pool closed');
  }
};

// Utility to run migrations from schema.sql
export const runMigrations = async (): Promise<void> => {
  try {
    const fs = await import('fs');
    const path = await import('path');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
    });

    await client.connect();
    await client.query(schema);
    await client.end();

    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error(error, 'Migration failed');
    throw error;
  }
};
