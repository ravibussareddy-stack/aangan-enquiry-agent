/**
 * Hard stop on real voice spend (VOICE_SPEND_CAP, ₹20 for this case study).
 * Counts only non-simulated calls' voice_minutes cost rows.
 */
import { loadRuntimeConfig } from "../config/runtime";
import { db } from "../db/client";

export async function voiceSpendSoFar(): Promise<number> {
  const { rows } = await db().query<{ total: string | null }>(
    `select sum(cc.cost_inr) total from call_costs cc join calls c on c.id = cc.call_id
     where cc.component = 'voice_minutes' and not c.is_simulated`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function assertVoiceSpendAllowed(): Promise<void> {
  const cfg = await loadRuntimeConfig();
  const spent = await voiceSpendSoFar();
  if (spent + cfg.voiceSpendCap.reserve_inr >= cfg.voiceSpendCap.cap_inr) {
    throw new Error(`Voice spend cap reached: ₹${spent.toFixed(2)} of ₹${cfg.voiceSpendCap.cap_inr}`);
  }
}
