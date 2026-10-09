/**
 * Run dashboard queries as a signed-in user under RLS
 * (db/migrations/*_rls.sql): founder sees everything, designers see the
 * review queue and their own leads. Authorization is still checked in the
 * server code first — RLS is the second line of defence.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { db } from "./client";

export async function asUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    // One round trip for begin + role + user (ids are Neon Auth ids; anything unusual takes the parameterised path).
    if (/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
      await client.query(`begin; set local role app_user; select set_config('app.user_id', '${userId}', true)`);
    } else {
      await client.query("begin");
      await client.query("set local role app_user");
      await client.query("select set_config('app.user_id', $1, true)", [userId]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
