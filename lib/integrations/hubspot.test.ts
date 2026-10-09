/** HubSpotCrm.syncLead against a fake HubSpot API: repeat callers and imported contacts. */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call { method: string; path: string; body: Record<string, unknown> | null }
const calls: Call[] = [];
let contacts: { id: string; properties: Record<string, string | null> }[] = [];
let dealsByContact: Record<string, { id: string; properties: Record<string, string | null> }[]> = {};

const STAGES = ["New qualified", "Callback needed", "Service review", "Admin review", "Booked", "Consultation held", "Won", "Lost", "Declined"];

vi.mock("../http/retry", () => ({
  fetchWithRetry: async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.hubapi.com", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    const json = (() => {
      if (path.startsWith("/crm/v3/pipelines/deals/")) return { stages: STAGES.map((label, i) => ({ id: `s${i}`, label })) };
      if (path.startsWith("/crm/v3/owners")) return { results: path.includes("asha") ? [{ id: "42", email: "asha@example.com" }] : [] };
      if (path === "/crm/v3/objects/contacts/search") return { results: contacts.slice(0, 1) };
      const assoc = path.match(/^\/crm\/v4\/objects\/contacts\/(\w+)\/associations\/deals$/);
      if (assoc) return { results: (dealsByContact[assoc[1]] ?? []).map((d) => ({ toObjectId: Number(d.id) })) };
      if (path === "/crm/v3/objects/deals/batch/read") return { results: Object.values(dealsByContact).flat() };
      if (method === "POST" && path === "/crm/v3/objects/contacts") return { id: "900" };
      if (method === "POST" && path === "/crm/v3/objects/deals") return { id: "800" };
      return { id: "1" };
    })();
    return new Response(JSON.stringify(json), { status: 200 });
  },
}));

process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test";
const { HubSpotCrm } = await import("./hubspot");

const sync = (over: Partial<Parameters<InstanceType<typeof HubSpotCrm>["syncLead"]>[0]> = {}) =>
  new HubSpotCrm().syncLead({ phone: "+919000001005", name: "Amit", dealName: "Amit — 3BHK Pimple Nilakh", stage: "Booked", properties: {}, note: "n", ...over });

const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.includes("search") && !c.path.includes("batch/read"));

beforeEach(() => {
  calls.length = 0;
  contacts = [];
  dealsByContact = {};
});

describe("HubSpotCrm.syncLead", () => {
  it("creates a contact and a deal for a new caller", async () => {
    const r = await sync();
    expect(r).toMatchObject({ contactId: "900", dealId: "800" });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(["POST /crm/v3/objects/contacts", "POST /crm/v3/objects/deals", "POST /crm/v3/objects/notes"]);
  });

  it("continues a repeat caller's open deal instead of creating a duplicate", async () => {
    contacts = [{ id: "55", properties: { firstname: "Amit", lastname: null, phone: "+919000001005" } }];
    dealsByContact = { "55": [{ id: "777", properties: { dealstage: "s4", pipeline: "default", createdate: "2026-10-09" } }] };
    const r = await sync();
    expect(r.dealId).toBe("777");
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(["PATCH /crm/v3/objects/deals/777", "POST /crm/v3/objects/notes"]);
  });

  it("starts a new deal when the caller's last deal is closed", async () => {
    contacts = [{ id: "55", properties: { firstname: "Amit", lastname: null, phone: "+919000001005" } }];
    dealsByContact = { "55": [{ id: "777", properties: { dealstage: "s6", pipeline: "default", createdate: "2026-01-01" } }] };
    expect((await sync()).dealId).toBe("800");
  });

  it("never overwrites an imported contact's name with what the caller said", async () => {
    contacts = [{ id: "66", properties: { firstname: "Amitabh", lastname: "Kulkarni", phone: null } }];
    await sync();
    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/crm/v3/objects/contacts/66");
    expect(patch?.body).toEqual({ properties: { phone: "+919000001005" } });
  });

  it("makes the booked designer the deal and contact owner when they're a HubSpot user", async () => {
    await sync({ ownerEmail: "asha@example.com" });
    const deal = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/deals");
    const contact = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts");
    expect((deal?.body as { properties: Record<string, string> }).properties.hubspot_owner_id).toBe("42");
    expect((contact?.body as { properties: Record<string, string> }).properties.hubspot_owner_id).toBe("42");
  });

  it("falls back to the founder when the designer isn't a HubSpot user", async () => {
    process.env.FOUNDER_EMAILS = "asha@example.com";
    await sync({ ownerEmail: "kabir@example.com" });
    const deal = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/deals");
    expect((deal?.body as { properties: Record<string, string> }).properties.hubspot_owner_id).toBe("42");
  });

  it("leaves the deal unowned when neither the designer nor a founder is a HubSpot user", async () => {
    process.env.FOUNDER_EMAILS = "nobody@example.com";
    await sync({ ownerEmail: "kabir@example.com" });
    const deal = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/deals");
    expect((deal?.body as { properties: Record<string, string> }).properties.hubspot_owner_id).toBeUndefined();
  });
});
