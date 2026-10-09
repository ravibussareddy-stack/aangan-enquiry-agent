/**
 * Webhook idempotency: (provider, event_id) is processed once. Returns false
 * for a duplicate delivery that already succeeded; a previously failed event
 * may be retried (attempts is incremented).
 */
import { db } from "../db/client";

export async function claimEvent(provider: string, eventId: string, payload: unknown): Promise<boolean> {
  const { rows } = await db().query<{ inserted: boolean; status: string }>(
    `insert into webhook_events (provider, event_id, payload) values ($1, $2, $3)
     on conflict (provider, event_id) do update set attempts = webhook_events.attempts + 1
     returning (xmax = 0) as inserted, status`,
    [provider, eventId, JSON.stringify(payload)],
  );
  return rows[0].inserted || rows[0].status === "failed";
}

export async function finishEvent(provider: string, eventId: string, error?: unknown) {
  await db().query("update webhook_events set status = $3, last_error = $4 where provider = $1 and event_id = $2", [
    provider,
    eventId,
    error ? "failed" : "processed",
    error ? String((error as Error).message ?? error).slice(0, 1000) : null,
  ]);
}

/** Run a handler once per event; records failures and alerts ops. */
export async function once(provider: string, eventId: string, payload: unknown, fn: () => Promise<void>): Promise<"processed" | "duplicate" | "failed"> {
  if (!(await claimEvent(provider, eventId, payload))) return "duplicate";
  try {
    await fn();
    await finishEvent(provider, eventId);
    return "processed";
  } catch (err) {
    await finishEvent(provider, eventId, err);
    const { alertOps } = await import("../staff/notify");
    await alertOps(`${provider} webhook ${eventId} failed: ${(err as Error).message}`);
    return "failed";
  }
}
