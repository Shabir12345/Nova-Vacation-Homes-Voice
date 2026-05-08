// One-shot diagnostic — run with: npx ts-node --transpile-only scripts/inspect-call.ts
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
});

const ask = async (sql: string, params: unknown[] = []) => {
  const r = await pool.query(sql, params);
  return r.rows;
};

(async () => {
  try {
    console.log('\n=== public schema tables ===');
    console.log(await ask(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `));

    console.log('\n=== call_logs columns (our DB) ===');
    console.log(await ask(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'call_logs'
      ORDER BY ordinal_position
    `));

    console.log('\n=== last 2 calls metadata ===');
    console.log(await ask(`
      SELECT call_id, created_at, ended_at, duration_seconds, top_intent,
             phone_number, escalated, escalation_reason, error_message
      FROM call_logs
      ORDER BY created_at DESC
      LIMIT 2
    `));

    console.log('\n=== agent_interactions columns ===');
    console.log(await ask(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_interactions'
      ORDER BY ordinal_position
    `));

    console.log('\n=== interactions for most recent call ===');
    const recent = await ask(`SELECT call_id FROM call_logs ORDER BY created_at DESC LIMIT 1`);
    if (recent[0]) {
      const callId = recent[0]['call_id'];
      console.log('Call ID:', callId);
      console.log(await ask(`
        SELECT *
        FROM agent_interactions
        WHERE call_id = $1
        ORDER BY id ASC
      `, [callId]));
    }
  } catch (e) {
    console.error('FAILED:', (e as Error).message);
  } finally {
    await pool.end();
  }
})();
