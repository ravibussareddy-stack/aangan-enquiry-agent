/**
 * Neon Postgres access. Server-only.
 *
 * - `db()` runs as the database owner: webhooks, cron, the voice brain.
 *   RLS does not apply — these paths must validate their own inputs.
 * - `asUser()` (as-user.ts) is for dashboard requests and runs under RLS.
 */
import { Pool } from "@neondatabase/serverless";

let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString });
  }
  return pool;
}
