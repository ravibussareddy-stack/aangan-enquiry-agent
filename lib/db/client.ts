/**
 * Neon Postgres access. Server-only.
 *
 * - `db()` runs as the database owner: webhooks, cron, the voice brain.
 *   RLS does not apply — these paths must validate their own inputs.
 * - `asUser()` (as-user.ts) is for dashboard requests and runs under RLS.
 */
import { neonConfig, Pool } from "@neondatabase/serverless";

// One-shot queries go over HTTP fetch: no WebSocket handshake on a cold serverless
// instance (measured ~1 s from cold). Transactions (pool.connect(), asUser) still
// use a WebSocket session.
neonConfig.poolQueryViaFetch = true;

let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString });
  }
  return pool;
}
