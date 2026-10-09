/**
 * Estimated project value for the founder's pipeline KPI (dashboard only — never
 * spoken). The caller's own budget when they gave one; otherwise the middle of the
 * studio's typical range (TYPICAL_BUDGETS) for their size. Null when there's
 * nothing to estimate from (no budget, no size, no rooms).
 */
import { ALLOWED_LOCALITIES } from "../qualify/data/service-area";
import type { TypicalBudgets } from "../qualify/typical-budget";

export interface ValueInput {
  budget_inr: number | null;
  project_type: string | null;
  scope_kind: string | null;
  carpet_sqft: number | null;
  rooms_in_scope: number | null;
  configuration: string | null;
}

/** Typical carpet area by configuration, used only when the caller gave no size. */
const SQFT_BY_BHK: Record<number, number> = { 1: 550, 2: 900, 3: 1300, 4: 1800, 5: 2400 };

const mid = (r: { low: number; high: number }) => (r.low + r.high) / 2;

export function estimateProjectValue(x: ValueInput, b: TypicalBudgets): { inr: number; basis: "budget" | "typical" } | null {
  if (x.budget_inr && x.budget_inr > 0) return { inr: x.budget_inr, basis: "budget" };
  if (x.project_type === "commercial") {
    return x.carpet_sqft ? { inr: x.carpet_sqft * mid(b.commercial_per_sqft_inr), basis: "typical" } : null;
  }
  const rooms = x.scope_kind === "single_room" ? 1 : x.scope_kind === "partial" ? x.rooms_in_scope : null;
  if (rooms) return { inr: rooms * mid(b.per_room_inr), basis: "typical" };
  const bhk = Number(/(\d)\s*bhk/i.exec(x.configuration ?? "")?.[1] ?? 0);
  const sqft = x.carpet_sqft ?? SQFT_BY_BHK[bhk] ?? null;
  return sqft ? { inr: sqft * mid(b.residential_per_sqft_inr), basis: "typical" } : null;
}

/** Probability a deal closes, from its deal-health score (0–100) — an estimate until win rates calibrate it. */
export function closeProbability(score: number | null): number {
  if (score == null) return 0.3;
  return Math.min(0.9, Math.max(0.05, score / 100));
}

/**
 * Group free-text localities under the studio's service-area names, so "Dahanukar
 * Colony, Kothrud" and "Kothrud, Dahanukar Colony" count as Kothrud. Areas named in
 * services.md win over sub-areas; anything unmatched keeps its own (trimmed) name.
 */
export function canonicalLocality(raw: string | null): string {
  const text = (raw ?? "").trim();
  if (!text) return "Not given";
  const lower = text.toLowerCase();
  const hits = ALLOWED_LOCALITIES.filter((l) => [l.name, ...(l.aliases ?? [])].some((n) => new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)));
  const best = hits.find((h) => h.named) ?? hits[0];
  return best?.name ?? text.split(",")[0].trim();
}
