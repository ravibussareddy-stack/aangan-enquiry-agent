/**
 * Qualification config. In production these values come from the
 * `config` table (editable on the dashboard settings page); the defaults are
 * read from db/seed/config.json so there is one source of truth.
 */
import { z } from "zod";
import seed from "../../db/seed/config.json";

export const QualifyConfig = z.object({
  scopeThreshold: z.number().min(0).max(1),
  budgetRejectRatio: z.number().min(0).max(1),
  askBudget: z.boolean(),
  commercialMinSqft: z.number().nonnegative(),
  commercialMinSqftMode: z.enum(["review", "decline"]),
  commercialMaxSqft: z.number().positive(),
  minLeadWeeks: z.number().nonnegative(),
  siteAvailableMaxWeeks: z.number().positive(),
  budgetFloor: z.object({
    residential_per_sqft_inr: z.number().positive(),
    per_room_inr: z.number().positive(),
    commercial_per_sqft_inr: z.number().positive(),
  }),
});
export type QualifyConfig = z.infer<typeof QualifyConfig>;

type ConfigRows = Record<string, unknown>;

/** Build a QualifyConfig from `config` table rows (key → value). */
export function qualifyConfigFromRows(rows: ConfigRows): QualifyConfig {
  return QualifyConfig.parse({
    scopeThreshold: rows.SCOPE_THRESHOLD,
    budgetRejectRatio: rows.BUDGET_REJECT_RATIO,
    askBudget: rows.ASK_BUDGET,
    commercialMinSqft: rows.COMMERCIAL_MIN_SQFT,
    commercialMinSqftMode: rows.COMMERCIAL_MIN_SQFT_MODE,
    commercialMaxSqft: rows.COMMERCIAL_MAX_SQFT,
    minLeadWeeks: rows.MIN_LEAD_WEEKS,
    siteAvailableMaxWeeks: rows.SITE_AVAILABLE_MAX_WEEKS,
    budgetFloor: rows.BUDGET_FLOOR,
  });
}

export function seedConfigRows(): ConfigRows {
  return Object.fromEntries(
    Object.entries(seed).map(([key, row]) => [key, row.value]),
  );
}

export function defaultQualifyConfig(
  overrides: Partial<QualifyConfig> = {},
): QualifyConfig {
  return { ...qualifyConfigFromRows(seedConfigRows()), ...overrides };
}
