export const DEAL_STAGES = [
  "New qualified",
  "Callback needed",
  "Service review",
  "Admin review",
  "Booked",
  "Consultation held",
  "Won",
  "Lost",
  "Declined",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export interface CallerLookup {
  existingClient: boolean;
  contactId: string | null;
  name: string | null;
  openProject: string | null;
  /** Deal stage of the most recent deal, if any. */
  lastStage: DealStage | null;
}

export interface LeadSync {
  phone: string;
  name: string | null;
  dealName: string;
  stage: DealStage;
  properties: Record<string, string | number | boolean | null>;
  note: string;
  existingDealId?: string | null;
  existingContactId?: string | null;
  /** Deal health band → HubSpot's built-in deal priority (hs_priority). */
  priority?: "high" | "medium" | "low" | null;
}

export interface Crm {
  readonly provider: "hubspot" | "mock";
  lookupByPhone(phone: string): Promise<CallerLookup>;
  syncLead(sync: LeadSync): Promise<{ contactId: string; dealId: string; dealUrl: string | null }>;
  setDealStage(dealId: string, stage: DealStage): Promise<void>;
  setDealPriority(dealId: string, priority: "high" | "medium" | "low" | null): Promise<void>;
  /** Current stage of each deal (null = not one of DEAL_STAGES); missing ids were deleted. */
  readDealStages(dealIds: string[]): Promise<Map<string, DealStage | null>>;
}
