import type { CallerLookup, Crm, DealStage, LeadSync } from "./types";

/** In-memory CRM for simulation. Seed `clients` with existing-client phones. */
export class MockCrm implements Crm {
  readonly provider = "mock" as const;
  readonly deals = new Map<string, { phone: string; stage: DealStage; name: string }>();
  constructor(private readonly clients: Record<string, { name: string; project: string }> = {}) {}

  async lookupByPhone(phone: string): Promise<CallerLookup> {
    const c = this.clients[phone];
    return c
      ? { existingClient: true, contactId: `mock_c_${phone}`, name: c.name, openProject: c.project, lastStage: "Won" }
      : { existingClient: false, contactId: null, name: null, openProject: null, lastStage: null };
  }

  async syncLead(sync: LeadSync) {
    const dealId = sync.existingDealId ?? `mock_d_${this.deals.size + 1}`;
    this.deals.set(dealId, { phone: sync.phone, stage: sync.stage, name: sync.dealName });
    return { contactId: `mock_c_${sync.phone}`, dealId, dealUrl: null };
  }

  async setDealPriority(dealId: string, priority: "high" | "medium" | "low" | null) {
    const d = this.deals.get(dealId) as ({ priority?: string | null } & object) | undefined;
    if (d) d.priority = priority;
  }

  async readDealStages(dealIds: string[]) {
    return new Map(dealIds.filter((id) => this.deals.has(id)).map((id) => [id, this.deals.get(id)!.stage] as const));
  }

  async setDealStage(dealId: string, stage: DealStage) {
    const d = this.deals.get(dealId);
    if (d) d.stage = stage;
  }
}
