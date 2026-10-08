/**
 * Hard rules (brief §5.1). Deterministic, confidence 1.0, no model needed.
 * A hard-rule result always overrides the agent's own assessment.
 */
import type { Category, DeclineReason, Engagement, LeadExtraction } from "../schema/lead";
import type { QualifyConfig } from "./config";
import { resolveServiceArea, type AreaResult } from "./service-area";

export type HardRuleName =
  | "service_area"
  | "excluded_category"
  | "excluded_engagement"
  | "commercial_size"
  | "timeline";

/**
 * pass      — rule satisfied (or nothing to check)
 * fail      — hard decline
 * soft_fail — rule not met but not confirmed enough to decline → designer review
 * unclear   — not enough information; agent should ask one direct question
 */
export type HardRuleStatus = "pass" | "fail" | "soft_fail" | "unclear";

export interface HardRuleResult {
  rule: HardRuleName;
  status: HardRuleStatus;
  reason: string;
  declineReason?: DeclineReason;
  /** Timeline only: a timeline was mentioned but no date could be resolved. */
  unresolved?: boolean;
}

const EXCLUDED_CATEGORIES: Partial<Record<Category, string>> = {
  restaurant: "Restaurants are outside our scope",
  cafe: "Cafés and restaurants are outside our scope",
  hotel: "Hotels and hospitality are outside our scope",
  retail: "Retail stores are outside our scope",
  gym: "Gyms are outside our scope",
};

const EXCLUDED_ENGAGEMENTS: Partial<Record<Engagement, string>> = {
  advice_only: "Advice / consultation only — our minimum is a room redesign with execution",
  decor_only: "Decor and styling only",
  furniture_sourcing_only: "Standalone furniture sourcing",
  vastu_only: "Vastu consultation only",
  self_execution: "Caller will do the execution themselves",
  structural: "Structural work (moving walls, permits)",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function weeksBetween(from: Date, toIsoDate: string): number {
  // Dates are calendar dates in Asia/Kolkata; compare at IST midnight.
  const to = new Date(`${toIsoDate}T00:00:00+05:30`).getTime();
  return (to - from.getTime()) / (7 * DAY_MS);
}

export function checkServiceArea(lead: LeadExtraction): HardRuleResult & { area: AreaResult } {
  const area = resolveServiceArea(lead);
  const status: HardRuleStatus =
    area.status === "in" ? "pass" : area.status === "out" ? "fail" : "unclear";
  return {
    rule: "service_area",
    status,
    reason: area.reason,
    declineReason: status === "fail" ? "area" : undefined,
    area,
  };
}

export function checkCategory(lead: LeadExtraction): HardRuleResult {
  const excluded = EXCLUDED_CATEGORIES[lead.category];
  return excluded
    ? { rule: "excluded_category", status: "fail", reason: excluded, declineReason: "category" }
    : { rule: "excluded_category", status: "pass", reason: `Category: ${lead.category}` };
}

export function checkEngagement(lead: LeadExtraction): HardRuleResult {
  const excluded = lead.structural_work_requested
    ? EXCLUDED_ENGAGEMENTS.structural
    : EXCLUDED_ENGAGEMENTS[lead.engagement];
  if (excluded) {
    return { rule: "excluded_engagement", status: "fail", reason: excluded, declineReason: "engagement" };
  }
  if (lead.engagement === "unknown") {
    return { rule: "excluded_engagement", status: "unclear", reason: "Not yet clear the caller wants design and execution" };
  }
  return { rule: "excluded_engagement", status: "pass", reason: "Design and execution" };
}

export function checkCommercialSize(lead: LeadExtraction, cfg: QualifyConfig): HardRuleResult {
  if (lead.project_type !== "commercial") {
    return { rule: "commercial_size", status: "pass", reason: "Not commercial" };
  }
  const sqft = lead.carpet_sqft;
  if (sqft == null) {
    return { rule: "commercial_size", status: "unclear", reason: "Commercial area not given" };
  }
  if (sqft > cfg.commercialMaxSqft) {
    return {
      rule: "commercial_size",
      status: "fail",
      reason: `${sqft} sq ft is above the ${cfg.commercialMaxSqft} sq ft commercial maximum`,
      declineReason: "commercial_size",
    };
  }
  if (sqft < cfg.commercialMinSqft) {
    const decline = cfg.commercialMinSqftMode === "decline";
    return {
      rule: "commercial_size",
      status: decline ? "fail" : "soft_fail",
      reason: `${sqft} sq ft is below the ${cfg.commercialMinSqft} sq ft commercial minimum`,
      declineReason: decline ? "commercial_size" : undefined,
    };
  }
  return { rule: "commercial_size", status: "pass", reason: `${sqft} sq ft commercial` };
}

/**
 * Timeline: the project must not need completing in under MIN_LEAD_WEEKS
 * (hard fail), and the site should be available for execution within
 * SITE_AVAILABLE_MAX_WEEKS (later → review, never auto-decline).
 * No deadline stated means there is no constraint to fail.
 */
export function checkTimeline(lead: LeadExtraction, cfg: QualifyConfig, callAt: Date): HardRuleResult {
  if (lead.completion_by) {
    const weeks = weeksBetween(callAt, lead.completion_by);
    if (weeks < cfg.minLeadWeeks) {
      return {
        rule: "timeline",
        status: "fail",
        reason: `Needs completion by ${lead.completion_by} (${weeks.toFixed(1)} weeks) — under the ${cfg.minLeadWeeks}-week minimum`,
        declineReason: "timeline",
      };
    }
  }
  if (lead.site_available_from) {
    const weeks = weeksBetween(callAt, lead.site_available_from);
    if (weeks > cfg.siteAvailableMaxWeeks) {
      return {
        rule: "timeline",
        status: "soft_fail",
        reason: `Site only available from ${lead.site_available_from} (${weeks.toFixed(1)} weeks) — later than ${cfg.siteAvailableMaxWeeks} weeks`,
      };
    }
  }
  return {
    // A timeline mentioned without a resolvable date ("before Diwali") can't be
    // judged here; evaluateLead then defers to the agent's own verdict.
    unresolved: !lead.completion_by && !!lead.timeline_text,
    rule: "timeline",
    status: "pass",
    reason: lead.completion_by
      ? `Completion by ${lead.completion_by} allows enough lead time`
      : "No deadline stated",
  };
}

export function runHardRules(lead: LeadExtraction, cfg: QualifyConfig, callAt: Date) {
  const area = checkServiceArea(lead);
  const results: HardRuleResult[] = [
    area,
    checkCategory(lead),
    checkEngagement(lead),
    checkCommercialSize(lead, cfg),
    checkTimeline(lead, cfg, callAt),
  ];
  return { results, area: area.area };
}
