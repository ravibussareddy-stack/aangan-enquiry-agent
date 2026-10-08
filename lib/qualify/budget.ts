/**
 * Budget gate (brief §5.3). The floor is internal — derived from
 * seed/pricing.md — and is never spoken or sent to the voice agent.
 */
import type { LeadExtraction } from "../schema/lead";
import type { QualifyConfig } from "./config";

export type FloorBasis = "residential_sqft" | "per_room" | "commercial_sqft";

export interface BudgetFloor {
  floorInr: number;
  basis: FloorBasis;
}

/**
 * - Full home: carpet sq ft × residential rate.
 * - Partial / single room with rooms named: rooms × per-room floor. The stated
 *   sq ft is usually the whole flat, not the area being designed (T10).
 * - Partial with only an area: area × residential rate.
 * - Commercial: sq ft × commercial rate.
 * Returns null when there isn't enough information to compute a floor.
 */
export function computeBudgetFloor(lead: LeadExtraction, cfg: QualifyConfig): BudgetFloor | null {
  const f = cfg.budgetFloor;
  if (lead.project_type === "commercial") {
    return lead.carpet_sqft
      ? { floorInr: lead.carpet_sqft * f.commercial_per_sqft_inr, basis: "commercial_sqft" }
      : null;
  }
  if (lead.project_type !== "residential") return null;

  if (lead.scope_kind === "full_home") {
    return lead.carpet_sqft
      ? { floorInr: lead.carpet_sqft * f.residential_per_sqft_inr, basis: "residential_sqft" }
      : null;
  }
  if (lead.scope_kind === "partial" || lead.scope_kind === "single_room") {
    const rooms = lead.rooms_in_scope ?? (lead.scope_kind === "single_room" ? 1 : null);
    if (rooms) return { floorInr: rooms * f.per_room_inr, basis: "per_room" };
    if (lead.carpet_sqft) {
      return { floorInr: lead.carpet_sqft * f.residential_per_sqft_inr, basis: "residential_sqft" };
    }
  }
  return null;
}

/**
 * fail       — confirmed budget below BUDGET_REJECT_RATIO × floor
 * tight      — below the floor but above the reject line → pass, flagged
 * pass       — at or above the floor
 * not_given  — no budget → pass (rubric: "If budget is not mentioned, treat as qualified")
 * no_floor   — budget given but not enough scope info to compute a floor → pass, flagged
 */
export type BudgetGateStatus = "pass" | "tight" | "fail" | "not_given" | "no_floor";

export interface BudgetGateResult {
  status: BudgetGateStatus;
  floor: BudgetFloor | null;
  /** budget / floor, when both are known. */
  ratio: number | null;
}

export function budgetGate(lead: LeadExtraction, cfg: QualifyConfig): BudgetGateResult {
  const floor = computeBudgetFloor(lead, cfg);
  if (lead.budget_inr == null) return { status: "not_given", floor, ratio: null };
  if (!floor) return { status: "no_floor", floor, ratio: null };

  const ratio = lead.budget_inr / floor.floorInr;
  const status: BudgetGateStatus =
    ratio < cfg.budgetRejectRatio ? "fail" : ratio < 1 ? "tight" : "pass";
  return { status, floor, ratio };
}
