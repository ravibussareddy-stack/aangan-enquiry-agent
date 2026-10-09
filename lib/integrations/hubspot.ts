/**
 * HubSpot CRM via a private app token (works on the Free tier).
 * - Contacts: search by phone (national number — HubSpot's phone search
 *   ignores the country code), then create or update.
 * - Deals: in HUBSPOT_PIPELINE_ID (or "default"); stages are matched by label
 *   (DEAL_STAGES), so on Free you rename/add the default pipeline's stages.
 * - Deal health band → built-in `hs_priority` (high/medium/low) — no custom property.
 * - Lead fields go into the deal description + a note, so no custom
 *   properties are required (Free allows very few).
 * - Stage changes made in HubSpot reach the app by polling (readDealStages,
 *   lib/crm/stage-sync.ts) because service keys can't send webhooks; the
 *   webhook route (signature v3) still works for a project-based app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEAL_STAGES, type CallerLookup, type Crm, type DealStage, type LeadSync } from "../crm/types";
import { fetchWithRetry } from "../http/retry";
import { nationalNumber } from "../phone";

const API = "https://api.hubapi.com";

/** Link to a deal in HubSpot's UI (null without HUBSPOT_PORTAL_ID or for mock ids). */
export function hubspotDealUrl(dealId: string | null): string | null {
  const portal = process.env.HUBSPOT_PORTAL_ID;
  return portal && dealId && !dealId.startsWith("mock_") ? `https://app.hubspot.com/contacts/${portal}/record/0-3/${dealId}` : null;
}

export function hubspotConfigured(): boolean {
  return !!process.env.HUBSPOT_PRIVATE_APP_TOKEN;
}

async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`HubSpot ${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const pipelineId = () => process.env.HUBSPOT_PIPELINE_ID || "default";
let stageCache: { byLabel: Map<string, string>; byId: Map<string, DealStage> } | undefined;

async function stages() {
  if (stageCache) return stageCache;
  const p = await hs<{ stages: { id: string; label: string }[] }>(`/crm/v3/pipelines/deals/${pipelineId()}`);
  const byLabel = new Map<string, string>();
  const byId = new Map<string, DealStage>();
  for (const s of p.stages) {
    const match = DEAL_STAGES.find((d) => d.toLowerCase() === s.label.trim().toLowerCase());
    if (match) {
      byLabel.set(match, s.id);
      byId.set(s.id, match);
    }
  }
  const missing = DEAL_STAGES.filter((d) => !byLabel.has(d));
  if (missing.length) throw new Error(`HubSpot pipeline ${pipelineId()} is missing stages: ${missing.join(", ")}`);
  return (stageCache = { byLabel, byId });
}

export async function stageForId(id: string): Promise<DealStage | null> {
  return (await stages()).byId.get(id) ?? null;
}

const ownerCache = new Map<string, string | null>();

/**
 * HubSpot user id for an email (deal owner). Designers must be users in the
 * HubSpot account. Needs the crm.objects.owners.read scope; without it (or
 * with no matching user) the deal is simply left unowned.
 */
export async function hubspotOwnerId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const key = email.toLowerCase();
  if (ownerCache.has(key)) return ownerCache.get(key)!;
  let id: string | null = null;
  try {
    const r = await hs<{ results: { id: string; email: string }[] }>(`/crm/v3/owners?email=${encodeURIComponent(key)}&limit=1`);
    id = r.results.find((o) => o.email?.toLowerCase() === key)?.id ?? null;
  } catch (err) {
    console.warn(`[hubspot] owner lookup for ${key} failed: ${(err as Error).message.slice(0, 120)}`);
  }
  ownerCache.set(key, id);
  return id;
}

/**
 * Deal owner: the booked / assigned designer if they're a HubSpot user, otherwise
 * the default owner — HUBSPOT_DEFAULT_OWNER_EMAIL, or the first FOUNDER_EMAILS
 * address — so no deal is left unowned.
 */
export async function dealOwnerId(designerEmail: string | null | undefined): Promise<string | null> {
  const fallback = process.env.HUBSPOT_DEFAULT_OWNER_EMAIL || (process.env.FOUNDER_EMAILS ?? "").split(",")[0]?.trim();
  return (await hubspotOwnerId(designerEmail)) ?? (await hubspotOwnerId(fallback));
}

export class HubSpotCrm implements Crm {
  readonly provider = "hubspot" as const;

  private async findContact(phone: string) {
    const found = await hs<{ results: { id: string; properties: Record<string, string | null> }[] }>(
      "/crm/v3/objects/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: nationalNumber(phone) }] },
            { filters: [{ propertyName: "phone", operator: "EQ", value: phone }] },
          ],
          properties: ["firstname", "lastname", "lifecyclestage", "phone", "hubspot_owner_id"],
          limit: 1,
        }),
      },
    );
    return found.results[0] ?? null;
  }

  /** The contact's latest deal in our pipeline that is still open (not Won / Lost / Declined). */
  private async openDealFor(contactId: string): Promise<string | null> {
    const assoc = await hs<{ results: { toObjectId: number }[] }>(`/crm/v4/objects/contacts/${contactId}/associations/deals`);
    if (!assoc.results.length) return null;
    const deals = await hs<{ results: { id: string; properties: Record<string, string | null> }[] }>("/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs: assoc.results.map((r) => ({ id: String(r.toObjectId) })), properties: ["dealstage", "pipeline", "createdate"] }),
    });
    const { byId } = await stages();
    const open = deals.results
      .filter((d) => d.properties.pipeline === pipelineId())
      .filter((d) => {
        const stage = byId.get(d.properties.dealstage ?? "");
        return !!stage && stage !== "Won" && stage !== "Lost" && stage !== "Declined";
      })
      .sort((a, b) => (b.properties.createdate ?? "").localeCompare(a.properties.createdate ?? ""));
    return open[0]?.id ?? null;
  }

  async lookupByPhone(phone: string): Promise<CallerLookup> {
    const contact = await this.findContact(phone);
    if (!contact) return { existingClient: false, contactId: null, name: null, openProject: null, lastStage: null };

    const assoc = await hs<{ results: { toObjectId: number }[] }>(`/crm/v4/objects/contacts/${contact.id}/associations/deals`);
    let lastStage: DealStage | null = null;
    let openProject: string | null = null;
    if (assoc.results.length) {
      const deals = await hs<{ results: { id: string; properties: Record<string, string | null> }[] }>(
        "/crm/v3/objects/deals/batch/read",
        {
          method: "POST",
          body: JSON.stringify({
            inputs: assoc.results.map((r) => ({ id: String(r.toObjectId) })),
            properties: ["dealname", "dealstage", "createdate"],
          }),
        },
      );
      const latest = deals.results.sort((a, b) => (b.properties.createdate ?? "").localeCompare(a.properties.createdate ?? ""))[0];
      lastStage = latest ? await stageForId(latest.properties.dealstage ?? "") : null;
      openProject = latest?.properties.dealname ?? null;
    }
    const name = [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ") || null;
    return {
      existingClient: contact.properties.lifecyclestage === "customer" || lastStage === "Won",
      contactId: contact.id,
      name,
      openProject,
      lastStage,
    };
  }

  async syncLead(sync: LeadSync) {
    const [firstname, ...rest] = (sync.name ?? "").split(" ");
    const nameProps = sync.name ? { firstname, lastname: rest.join(" ") } : {};
    const ownerForContact = await dealOwnerId(sync.ownerEmail);
    let contactId = sync.existingContactId ?? null;
    if (!contactId) {
      // An existing contact (an earlier caller, or one imported from Gmail) keeps its name:
      // only fill in what's missing, never overwrite it with what the caller said on the phone.
      const existing = await this.findContact(sync.phone);
      if (existing) {
        contactId = existing.id;
        const fill = {
          ...(!existing.properties.phone ? { phone: sync.phone } : {}),
          ...(!existing.properties.firstname && !existing.properties.lastname ? nameProps : {}),
          ...(ownerForContact && !existing.properties.hubspot_owner_id ? { hubspot_owner_id: ownerForContact } : {}),
        };
        if (Object.keys(fill).length) await hs(`/crm/v3/objects/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ properties: fill }) });
      }
    }
    if (!contactId) {
      const contactProps = { phone: sync.phone, ...nameProps, ...(ownerForContact ? { hubspot_owner_id: ownerForContact } : {}) };
      contactId = (await hs<{ id: string }>("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties: contactProps }) })).id;
    }

    const ownerId = ownerForContact;
    const stageId = (await stages()).byLabel.get(sync.stage)!;
    const description = Object.entries(sync.properties)
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const dealProps = {
      dealname: sync.dealName,
      pipeline: pipelineId(),
      dealstage: stageId,
      description: description.slice(0, 5000),
      ...(sync.priority ? { hs_priority: sync.priority } : {}),
      ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
    };
    // A repeat caller continues their open deal instead of getting a duplicate.
    let dealId = sync.existingDealId ?? (await this.openDealFor(contactId));
    if (dealId) {
      await hs(`/crm/v3/objects/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ properties: dealProps }) });
    } else {
      dealId = (
        await hs<{ id: string }>("/crm/v3/objects/deals", {
          method: "POST",
          body: JSON.stringify({
            properties: dealProps,
            associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
          }),
        })
      ).id;
    }
    await hs("/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: sync.note.replace(/\n/g, "<br>") },
        associations: [{ to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] }],
      }),
    });
    return { contactId, dealId, dealUrl: hubspotDealUrl(dealId) };
  }

  async setDealPriority(dealId: string, priority: "high" | "medium" | "low" | null) {
    await hs(`/crm/v3/objects/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ properties: { hs_priority: priority ?? "" } }) });
  }

  async readDealStages(dealIds: string[]) {
    const { byId } = await stages();
    const out = new Map<string, DealStage | null>();
    for (let i = 0; i < dealIds.length; i += 100) {
      const r = await hs<{ results: { id: string; properties: { dealstage?: string | null } }[] }>("/crm/v3/objects/deals/batch/read", {
        method: "POST",
        body: JSON.stringify({ inputs: dealIds.slice(i, i + 100).map((id) => ({ id })), properties: ["dealstage"] }),
      });
      for (const d of r.results) out.set(d.id, d.properties.dealstage ? (byId.get(d.properties.dealstage) ?? null) : null);
    }
    return out;
  }

  async setDealStage(dealId: string, stage: DealStage) {
    const stageId = (await stages()).byLabel.get(stage)!;
    await hs(`/crm/v3/objects/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ properties: { dealstage: stageId } }) });
  }
}

/**
 * HubSpot signature v3: base64(HMAC-SHA256(clientSecret, method + uri + body + timestamp)),
 * rejected if the timestamp is older than 5 minutes.
 */
export function verifyHubSpotSignatureV3(opts: {
  method: string;
  uri: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  clientSecret: string;
  now?: number;
}): boolean {
  if (!opts.signature || !opts.timestamp) return false;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || Math.abs((opts.now ?? Date.now()) - ts) > 5 * 60_000) return false;
  const expected = createHmac("sha256", opts.clientSecret)
    .update(`${opts.method}${opts.uri}${opts.rawBody}${opts.timestamp}`)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
