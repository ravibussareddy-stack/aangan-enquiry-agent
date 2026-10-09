/**
 * HubSpot → app stage pull (lib/crm/stage-sync.ts) against an in-process
 * Postgres with every migration applied and a fake HubSpot.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealStage } from "../lib/crm/types";

const pg = new PGlite();
const query = async (sql: string, params: unknown[] = []) => {
  const r = await pg.query(sql, params);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
vi.mock("../lib/db/client", () => ({ db: () => ({ query, connect: async () => ({ query, release: () => undefined }) }) }));

const hubspot = new Map<string, DealStage>();
const writes: [string, DealStage][] = [];
vi.mock("../lib/crm/index", () => ({
  getCrm: () => ({
    provider: "hubspot",
    readDealStages: async (ids: string[]) => new Map(ids.filter((id) => hubspot.has(id)).map((id) => [id, hubspot.get(id)!])),
    setDealStage: async (id: string, stage: DealStage) => {
      writes.push([id, stage]);
      hubspot.set(id, stage);
    },
  }),
}));

const { pullCrmStages, setLeadDealStage } = await import("../lib/crm/stage-sync");

const REVIEW = "cccccccc-0000-0000-0000-000000000001";
const BOOKED = "cccccccc-0000-0000-0000-000000000002";
const MOCK = "cccccccc-0000-0000-0000-000000000003";

beforeAll(async () => {
  for (const f of readdirSync("db/migrations").sort()) await pg.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await pg.exec(readFileSync("db/seed.sql", "utf8"));
  await pg.exec(`
    insert into leads (id, phone, status, review_queue, extraction, evaluation, hubspot_deal_id, hubspot_stage) values
      ('${REVIEW}', '+919000000011', 'review', 'designer', '{}', '{}', '101', 'Service review'),
      ('${BOOKED}', '+919000000012', 'qualified', 'designer', '{}', '{}', '102', 'Booked'),
      ('${MOCK}', '+919000000013', 'review', 'designer', '{}', '{}', 'mock_d_1', null);
    insert into bookings (lead_id, event_type, slot_start, slot_end, status)
      values ('${BOOKED}', 'residential_consult', now(), now() + interval '1 hour', 'booked');
  `);
  hubspot.set("101", "Service review").set("102", "Booked").set("mock_d_1", "Admin review");
});

beforeEach(async () => {
  await pg.query("update crm_sync_state set last_run_at = null");
});

const lead = async (id: string) =>
  (await pg.query<{ status: string; review_queue: string | null; hubspot_stage: string | null }>("select status::text, review_queue, hubspot_stage from leads where id = $1", [id])).rows[0];

describe("pullCrmStages", () => {
  it("does nothing when HubSpot matches what the app last wrote", async () => {
    const r = await pullCrmStages();
    expect(r).toMatchObject({ ran: true, checked: 2, changes: [] });
  });

  it("applies a stage someone changed in HubSpot (route to admin review)", async () => {
    hubspot.set("101", "Admin review");
    const r = await pullCrmStages();
    expect(r.changes).toEqual([{ leadId: REVIEW, stage: "Admin review", effect: "routed to Admin review" }]);
    expect(await lead(REVIEW)).toMatchObject({ status: "review", review_queue: "admin", hubspot_stage: "Admin review" });
  });

  it("records won / lost on the booking for the funnel", async () => {
    hubspot.set("102", "Won");
    const r = await pullCrmStages();
    expect(r.changes.map((c) => c.effect)).toEqual(["booking won"]);
    const { rows } = await pg.query<{ outcome: string }>("select outcome from bookings where lead_id = $1", [BOOKED]);
    expect(rows[0].outcome).toBe("won");
  });

  it("ignores mock-CRM deal ids", async () => {
    expect((await lead(MOCK)).review_queue).toBe("designer");
  });

  it("doesn't treat the app's own stage writes as HubSpot changes", async () => {
    await setLeadDealStage("101", "Callback needed");
    expect(writes.at(-1)).toEqual(["101", "Callback needed"]);
    expect((await pullCrmStages()).changes).toEqual([]);
  });

  it("is throttled unless forced", async () => {
    expect((await pullCrmStages()).ran).toBe(true);
    expect((await pullCrmStages()).ran).toBe(false);
    expect((await pullCrmStages({ force: true })).ran).toBe(true);
  });
});
