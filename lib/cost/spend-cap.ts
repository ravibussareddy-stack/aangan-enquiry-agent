/**
 * Real voice spend so far (non-simulated calls' voice_minutes cost rows).
 * There is no overall spend cap (founder, 2026-10-10): each call is limited in
 * time instead (QUICK_TEST_MINUTES / VOICE_SPEND_CAP.max_call_s, and Vaani's own
 * maximum call duration), which bounds what any one call can cost.
 */
import { db } from "../db/client";

export async function voiceSpendSoFar(): Promise<number> {
  const { rows } = await db().query<{ total: string | null }>(
    `select sum(cc.cost_inr) total from call_costs cc join calls c on c.id = cc.call_id
     where cc.component = 'voice_minutes' and not c.is_simulated`,
  );
  return Number(rows[0]?.total ?? 0);
}
