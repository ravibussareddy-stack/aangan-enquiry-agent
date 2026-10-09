/**
 * Applies every migration + seed to an in-process Postgres (PGlite), then
 * checks the RLS rules as the dashboard runs them (role app_user +
 * app.user_id): founder sees everything; designers see the review queue and
 * their own leads.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const FOUNDER = "user_founder";
const ASHA = "user_asha";
const ROHAN = "user_rohan";
const ASHA_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ROHAN_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const QUALIFIED_FOR_ASHA = "bbbbbbbb-0000-0000-0000-000000000001";
const IN_REVIEW = "bbbbbbbb-0000-0000-0000-000000000002";
const DECLINED = "bbbbbbbb-0000-0000-0000-000000000003";

let db: PGlite;

async function as<T>(uid: string, sql: string): Promise<T[]> {
  await db.exec(`set role app_user; select set_config('app.user_id', '${uid}', false);`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec("reset role;");
  }
}

const review = (leadId: string, designerId: string) =>
  `insert into reviews (lead_id, reviewer, reviewer_designer_id, decision, source)
   values ('${leadId}', 'x', '${designerId}', 'approved', 'dashboard')`;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations").sort()) {
    await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  }
  const seed = readFileSync("db/seed.sql", "utf8");
  await db.exec(seed);
  await db.exec(seed); // idempotent

  await db.exec(`
    insert into designers (id, name) values ('${ASHA_ID}', 'Asha'), ('${ROHAN_ID}', 'Rohan');
    insert into profiles values
      ('${FOUNDER}', 'founder', null),
      ('${ASHA}', 'designer', '${ASHA_ID}'),
      ('${ROHAN}', 'designer', '${ROHAN_ID}');
    insert into leads (id, phone, status, assigned_designer_id, extraction, evaluation) values
      ('${QUALIFIED_FOR_ASHA}', '+919000000001', 'qualified', '${ASHA_ID}', '{}', '{}'),
      ('${IN_REVIEW}', '+919000000002', 'review', null, '{}', '{}'),
      ('${DECLINED}', '+919000000003', 'declined', null, '{}', '{}');
    insert into criteria (lead_id, criterion, verdict, source) values ('${DECLINED}', 'area', 'fail', 'server');
  `);
});

describe("migrations + seed", () => {
  it("seeds every config key and rate", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from config");
    expect(rows[0].n).toBe(Object.keys(JSON.parse(readFileSync("db/seed/config.json", "utf8"))).length);
  });

  it("looks up the rate in effect", async () => {
    const { rows } = await db.query<{ unit_rate_inr: string }>(
      "select unit_rate_inr from rate_at('voice_minutes', 'minute', now())",
    );
    expect(Number(rows[0].unit_rate_inr)).toBe(5);
  });

  it("requires every cost row to belong to a call or an insights run", async () => {
    await expect(
      db.query("insert into call_costs (component, unit, units, unit_rate_inr, cost_inr) values ('sms', 'message', 1, 0.3, 0.3)"),
    ).rejects.toThrow(/cost_has_owner/);
  });
});

describe("RLS", () => {
  const leadStatuses = (uid: string) =>
    as<{ status: string }>(uid, "select status from leads order by phone").then((r) => r.map((x) => x.status));

  it("founder sees every lead", async () => {
    expect(await leadStatuses(FOUNDER)).toEqual(["qualified", "review", "declined"]);
  });

  it("designer sees their own leads and the review queue", async () => {
    expect(await leadStatuses(ASHA)).toEqual(["qualified", "review"]);
    expect(await leadStatuses(ROHAN)).toEqual(["review"]);
  });

  it("designer cannot read config, rates, costs or other leads' criteria", async () => {
    for (const table of ["config", "rates", "call_costs", "insights", "webhook_events", "criteria", "crm_sync_state"]) {
      expect(await as(ASHA, `select * from ${table}`), table).toEqual([]);
    }
  });

  it("designer cannot change config", async () => {
    expect(await as(ASHA, "update config set value = '0.1' where key = 'SCOPE_THRESHOLD' returning key")).toEqual([]);
  });

  it("designer can approve a lead in review, as themselves", async () => {
    expect(await as(ROHAN, `${review(IN_REVIEW, ROHAN_ID)} returning decision`)).toEqual([{ decision: "approved" }]);
  });

  it("designer cannot review a lead that is not in review", async () => {
    await expect(as(ROHAN, review(DECLINED, ROHAN_ID))).rejects.toThrow(/row-level security/);
  });

  it("designer cannot record a review as someone else", async () => {
    await expect(as(ROHAN, review(QUALIFIED_FOR_ASHA, ASHA_ID))).rejects.toThrow(/row-level security/);
  });
});
