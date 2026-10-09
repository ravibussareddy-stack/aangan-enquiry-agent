/**
 * evaluateLead — decision bands (brief §5.2) on top of the hard rules (§5.1)
 * and the budget gate (§5.3). The agent proposes (criteria + confidences);
 * the server decides. Used in-call (check_scope / evaluate_lead tools) and
 * post-call on the stored extraction.
 */
import {
  CRITERIA,
  type CriterionAssessment,
  type CriterionKey,
  type DeclineReason,
  type LeadExtraction,
  type LeadOutcome,
} from "../schema/lead";
import { budgetGate, type BudgetGateResult } from "./budget";
import type { QualifyConfig } from "./config";
import { runHardRules, type HardRuleResult } from "./rules";
import type { AreaResult } from "./service-area";

export type LeadFlag =
  | "asked_about_price"
  | "budget_tight"
  | "budget_not_given"
  | "budget_unconfirmed"
  | "budget_no_floor"
  | "decision_maker_unclear"
  | "repeat_caller"
  | "frustrated"
  | "escalated_in_call_not_a_complaint"
  | "commercial_below_min"
  | "site_available_late"
  | "area_unclear"
  | "site_visit_requested"
  | "oos_confidence_contradicted";

export interface MergedCriterion extends CriterionAssessment {
  source: "agent" | "server";
}

export interface Evaluation {
  outcome: LeadOutcome;
  declineReason: DeclineReason | null;
  /** Human-readable reasons, most important first. For the handoff note and logs. */
  reasons: string[];
  hardRules: HardRuleResult[];
  area: AreaResult;
  budget: BudgetGateResult;
  criteria: Record<CriterionKey, MergedCriterion>;
  flags: LeadFlag[];
  /** In-call: the one criterion (1–3) the agent should ask a direct question about. */
  askNext: CriterionKey | null;
}

const BLOCKING: CriterionKey[] = ["real_project", "area", "timeline"];
const IN_SCOPE_CATEGORIES = ["apartment", "independent_house", "villa", "office", "clinic", "studio", "coworking"];

function mergeCriteria(
  lead: LeadExtraction,
  hard: HardRuleResult[],
  area: AreaResult,
  budget: BudgetGateResult,
): Record<CriterionKey, MergedCriterion> {
  const rule = (name: HardRuleResult["rule"]) => hard.find((r) => r.rule === name)!;
  const agent = (key: CriterionKey): MergedCriterion => ({ ...lead.criteria[key], source: "agent" });
  const server = (verdict: MergedCriterion["verdict"], evidence: string): MergedCriterion => ({
    verdict,
    evidence,
    source: "server",
  });

  const engagement = rule("excluded_engagement");
  const real_project =
    engagement.status === "fail"
      ? server("fail", engagement.reason)
      : engagement.status === "pass" && lead.criteria.real_project.verdict !== "fail"
        ? server("pass", lead.criteria.real_project.evidence || engagement.reason)
        : agent("real_project");

  const areaCriterion = server(
    area.status === "in" ? "pass" : area.status === "out" ? "fail" : "unclear",
    area.reason,
  );

  const timelineRule = rule("timeline");
  const timeline =
    timelineRule.unresolved && lead.criteria.timeline.verdict === "fail"
      ? agent("timeline") // server had no date to judge; the agent heard an impossible deadline
      : server(
          timelineRule.status === "fail" ? "fail" : timelineRule.status === "pass" ? "pass" : "unclear",
          lead.criteria.timeline.evidence || timelineRule.reason,
        );

  const budgetCriterion =
    budget.status === "fail" && lead.budget_confirmed
      ? server("fail", "Confirmed budget is well below what this scope involves")
      : budget.status === "pass" || budget.status === "tight"
        ? server("pass", budget.status === "tight" ? "Budget below the floor (tight)" : "Budget fits the scope")
        : server("unclear", budget.status === "not_given" ? "Budget not given" : "Budget not confirmed or scope unclear");

  const decision_maker =
    lead.decision_maker === "self" || lead.decision_maker === "authorised"
      ? server("pass", lead.criteria.decision_maker.evidence || lead.decision_maker)
      : lead.decision_maker === "on_behalf_unconfirmed"
        ? server("unclear", lead.decision_maker_note ?? "Calling on behalf of the decision-maker")
        : lead.criteria.decision_maker.verdict === "fail"
          ? agent("decision_maker")
          : server("unclear", "Decision-maker not established");

  return { real_project, area: areaCriterion, timeline, budget: budgetCriterion, decision_maker };
}

export function evaluateLead(
  lead: LeadExtraction,
  cfg: QualifyConfig,
  callAt: Date,
): Evaluation {
  const { results: hardRules, area } = runHardRules(lead, cfg, callAt);
  const budget = budgetGate(lead, cfg);
  const criteria = mergeCriteria(lead, hardRules, area, budget);

  const flags = new Set<LeadFlag>();
  if (lead.asked_about_price) flags.add("asked_about_price");
  if (lead.repeat_caller) flags.add("repeat_caller");
  if (lead.frustrated) flags.add("frustrated");
  if (lead.wants_site_visit) flags.add("site_visit_requested");
  if (area.status === "unclear") flags.add("area_unclear");
  if (criteria.decision_maker.verdict !== "pass") flags.add("decision_maker_unclear");
  if (budget.status === "tight") flags.add("budget_tight");
  if (budget.status === "not_given") flags.add("budget_not_given");
  if (budget.status === "no_floor") flags.add("budget_no_floor");
  if (budget.status === "fail" && !lead.budget_confirmed) flags.add("budget_unconfirmed");
  for (const r of hardRules) {
    if (r.rule === "commercial_size" && r.status === "soft_fail") flags.add("commercial_below_min");
    if (r.rule === "timeline" && r.status === "soft_fail") flags.add("site_available_late");
  }

  const askNext = BLOCKING.find((k) => criteria[k].verdict === "unclear") ?? null;
  const result = (
    outcome: LeadOutcome,
    declineReason: DeclineReason | null,
    reasons: string[],
  ): Evaluation => ({
    outcome,
    declineReason,
    reasons,
    hardRules,
    area,
    budget,
    criteria,
    flags: [...flags],
    askNext: outcome === "review" ? askNext : null,
  });

  // 1. Existing-client complaint → senior callback, nothing else applies.
  if (lead.complaint_detected) {
    return result("complaint", null, ["Existing client complaint"]);
  }

  // 2. Hard rules override everything the agent says.
  const hardFail = hardRules.find((r) => r.status === "fail");
  if (hardFail) {
    return result("declined", hardFail.declineReason ?? null, [hardFail.reason]);
  }

  // 3. Agent is confident it's out of scope — unless the structured facts contradict it:
  //    no hard rule failed and this is a home/office design+execution project. A
  //    self-reported number alone must not auto-decline such a lead (brief rule 4).
  const structurallyInScope =
    hardRules.every((r) => r.status !== "fail") &&
    lead.engagement === "design_and_execution" &&
    IN_SCOPE_CATEGORIES.includes(lead.category);
  if (lead.out_of_scope_confidence >= cfg.scopeThreshold && structurallyInScope) {
    flags.add("oos_confidence_contradicted");
  } else if (lead.out_of_scope_confidence >= cfg.scopeThreshold) {
    return result("declined", "out_of_scope", [
      `Agent out-of-scope confidence ${lead.out_of_scope_confidence.toFixed(2)} ≥ ${cfg.scopeThreshold}`,
    ]);
  }

  // 4. Rubric: two or more criteria fail → decline.
  const failed = CRITERIA.filter((k) => criteria[k].verdict === "fail");
  if (failed.length >= 2) {
    return result("declined", "multiple_criteria", failed.map((k) => `${k}: ${criteria[k].evidence}`));
  }

  // 5. Unsure WHETHER they want a project at all → front desk / callback.
  //    (A caller who also fails another criterion goes to review instead; "just
  //    exploring" itself naturally reads as real_project unclear/fail.)
  if (lead.unsure_intent && failed.every((k) => k === "real_project")) {
    return result("redirect", null, ["Caller is unsure whether they want a project"]);
  }

  // 6. In-scope path: confident, every hard rule cleanly passed, criteria 1–3 pass,
  //    and nothing other than budget failed (budget is decided by the gate below).
  const softOrUnclear = hardRules.filter((r) => r.status === "soft_fail" || r.status === "unclear");
  const inScope =
    lead.in_scope_confidence >= cfg.scopeThreshold &&
    softOrUnclear.length === 0 &&
    BLOCKING.every((k) => criteria[k].verdict === "pass") &&
    failed.every((k) => k === "budget");

  if (inScope) {
    if (budget.status === "fail") {
      if (lead.budget_confirmed) {
        return result("declined", "budget", ["Confirmed budget is well below the internal floor for this scope"]);
      }
      return result("review", null, ["Budget looks low but was not confirmed back to the caller"]);
    }
    return result("qualified", null, ["All hard rules pass and in-scope confidence is high"]);
  }

  // 7. Everything else → designer review (budget is collected but never rejects here).
  const reasons = [
    ...softOrUnclear.map((r) => r.reason),
    ...failed.map((k) => `${k}: ${criteria[k].evidence}`),
    ...BLOCKING.filter((k) => criteria[k].verdict === "unclear").map((k) => `${k} unclear`),
  ];
  if (lead.in_scope_confidence < cfg.scopeThreshold) {
    reasons.push(`In-scope confidence ${lead.in_scope_confidence.toFixed(2)} < ${cfg.scopeThreshold}`);
  }
  return result("review", null, reasons);
}
