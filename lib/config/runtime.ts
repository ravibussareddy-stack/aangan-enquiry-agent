/**
 * Runtime config: the `config` table when a database is configured,
 * otherwise the seed defaults (db/seed/config.json). Cached for 60 s.
 */
import { qualifyConfigFromRows, seedConfigRows, type QualifyConfig } from "../qualify/config";
import type { OfficeHours } from "../time/ist";

export interface RuntimeConfig {
  qualify: QualifyConfig;
  askBudget: boolean;
  officeHours: OfficeHours;
  callLimits: { target_s: number; soft_wrap_s: number; hard_max_s: number };
  dropRecovery: { callback_within_s: number; max_attempts: number };
  approvalCallback: { max_attempts: number; slots_to_offer: number };
  /** No overall ₹ cap any more (2026-10-10); cap_inr/reserve_inr in old rows are ignored. */
  voiceSpendCap: { max_call_s: number; outbound_attempts: number };
  complaintCallbackMinutes: number;
  insightsRefreshDailyLimit: number;
  promptVersion: string;
  smsProvider: "console" | "msg91";
  priceDeflectionLine: string;
  priceDeflectionNoBooking: string;
  declineLine: string;
  smsTemplates: Record<string, { dlt_template_id: string | null; text: string }>;
  answerMode: { mode: "overflow" | "always"; forward_after_rings: number };
  insufficientInfo: { min_missing_core: number; core_fields: string[] };
  dealHealthBands: { high: number; medium: number };
  shareTypicalBudget: boolean;
  typicalBudgets: import("../qualify/typical-budget").TypicalBudgets;
  raw: Record<string, unknown>;
}

export function runtimeConfigFromRows(rows: Record<string, unknown>): RuntimeConfig {
  const merged = { ...seedConfigRows(), ...rows };
  return {
    qualify: qualifyConfigFromRows(merged),
    askBudget: merged.ASK_BUDGET as boolean,
    officeHours: merged.OFFICE_HOURS as OfficeHours,
    callLimits: merged.CALL_LIMITS as RuntimeConfig["callLimits"],
    dropRecovery: merged.DROP_RECOVERY as RuntimeConfig["dropRecovery"],
    approvalCallback: merged.APPROVAL_CALLBACK as RuntimeConfig["approvalCallback"],
    voiceSpendCap: merged.VOICE_SPEND_CAP as RuntimeConfig["voiceSpendCap"],
    complaintCallbackMinutes: merged.COMPLAINT_CALLBACK_MINUTES as number,
    insightsRefreshDailyLimit: merged.INSIGHTS_REFRESH_DAILY_LIMIT as number,
    promptVersion: merged.PROMPT_VERSION as string,
    smsProvider: (process.env.SMS_PROVIDER ?? merged.SMS_PROVIDER) as RuntimeConfig["smsProvider"],
    priceDeflectionLine: merged.PRICE_DEFLECTION_LINE as string,
    priceDeflectionNoBooking: merged.PRICE_DEFLECTION_LINE_NO_BOOKING as string,
    declineLine: merged.DECLINE_LINE as string,
    smsTemplates: merged.SMS_TEMPLATES as RuntimeConfig["smsTemplates"],
    answerMode: merged.ANSWER_MODE as RuntimeConfig["answerMode"],
    insufficientInfo: merged.INSUFFICIENT_INFO as RuntimeConfig["insufficientInfo"],
    dealHealthBands: merged.DEAL_HEALTH_BANDS as RuntimeConfig["dealHealthBands"],
    shareTypicalBudget: merged.SHARE_TYPICAL_BUDGET as boolean,
    typicalBudgets: merged.TYPICAL_BUDGETS as RuntimeConfig["typicalBudgets"],
    raw: merged,
  };
}

export function seedRuntimeConfig(): RuntimeConfig {
  return runtimeConfigFromRows({});
}

let cache: { at: number; value: RuntimeConfig } | undefined;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (!process.env.DATABASE_URL) return seedRuntimeConfig();
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const { db } = await import("../db/client");
  const { rows } = await db().query<{ key: string; value: unknown }>("select key, value from config");
  const value = runtimeConfigFromRows(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  cache = { at: Date.now(), value };
  return value;
}

export function clearRuntimeConfigCache() {
  cache = undefined;
}
