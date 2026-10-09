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

export class HubSpotCrm implements Crm {
  readonly provider = "hubspot" as const;

  async lookupByPhone(phone: string): Promise<CallerLookup> {
    const found = await hs<{ results: { id: string; properties: Record<string, string | null> }[] }>(
      "/crm/v3/objects/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: nationalNumber(phone) }] },
            { filters: [{ propertyName: "phone", operator: "EQ", value: phone }] },
          ],
          properties: ["firstname", "lastname", "lifecyclestage"],
          limit: 1,
        }),
      },
    );
    const contact = found.results[0];
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
    const contactProps = { phone: sync.phone, ...(sync.name ? { firstname, lastname: rest.join(" ") } : {}) };
    let contactId = sync.existingContactId ?? (await this.lookupByPhone(sync.phone)).contactId;
    if (contactId) {
      await hs(`/crm/v3/objects/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ properties: contactProps }) });
    } else {
      contactId = (await hs<{ id: string }>("/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties: contactProps }) })).id;
    }

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
    };
    let dealId = sync.existingDealId ?? null;
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
