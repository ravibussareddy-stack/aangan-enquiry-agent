/**
 * One-off: restore HubSpot's default contact lifecycle stage names after they
 * were renamed to the deal stage names by mistake, and remove the extra
 * "Declined" stage if no contact or company uses it. Matches stages by their
 * fixed internal ids, so it is safe to re-run. DRY RUN by default.
 *
 *   npm run hubspot:lifecycle              # dry run
 *   npm run hubspot:lifecycle -- --apply
 *
 * Needs the crm.schemas.contacts.write scope on the service key (remove it after).
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set in .env.local");
const apply = process.argv.includes("--apply");
const PIPELINE = "contacts-lifecycle-pipeline";

const DEFAULTS: Record<string, string> = {
  subscriber: "Subscriber",
  lead: "Lead",
  marketingqualifiedlead: "Marketing Qualified Lead",
  salesqualifiedlead: "Sales Qualified Lead",
  opportunity: "Opportunity",
  customer: "Customer",
  evangelist: "Evangelist",
  other: "Other",
};

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(json as { message?: string }).message ?? ""}`);
  return json as T;
}

type Stage = { id: string; label: string; displayOrder: number };

/** Records on this stage; companies may be unreadable with this key (HubSpot then refuses an in-use delete anyway). */
async function usedBy(object: "contacts" | "companies", stageId: string): Promise<number> {
  try {
    const r = await hs<{ total: number }>("POST", `/crm/v3/objects/${object}/search`, {
      filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: stageId }] }],
      limit: 1,
    });
    return r.total;
  } catch (err) {
    if (object === "companies" && String(err).includes("403")) return 0;
    throw err;
  }
}

async function main() {
  const p = await hs<{ stages: Stage[] }>("GET", `/crm/v3/pipelines/contacts/${PIPELINE}`);

  for (const s of p.stages.sort((a, b) => a.displayOrder - b.displayOrder)) {
    const want = DEFAULTS[s.id];
    if (want) {
      if (s.label === want) {
        console.log(`· "${s.label}" already correct`);
        continue;
      }
      if (apply) await hs("PATCH", `/crm/v3/pipelines/contacts/${PIPELINE}/stages/${s.id}`, { label: want });
      console.log(`${apply ? "✓" : "[dry run]"} rename "${s.label}" → "${want}"`);
    } else if (s.label.trim().toLowerCase() === "declined") {
      const n = (await usedBy("contacts", s.id)) + (await usedBy("companies", s.id));
      if (n > 0) {
        console.log(`! "Declined" is used by ${n} record(s) — left in place; move them first.`);
        continue;
      }
      if (apply) await hs("DELETE", `/crm/v3/pipelines/contacts/${PIPELINE}/stages/${s.id}`);
      console.log(`${apply ? "✓" : "[dry run]"} delete unused "Declined" stage`);
    } else {
      console.log(`· leaving custom stage "${s.label}" as is`);
    }
  }

  if (apply) {
    const after = await hs<{ stages: Stage[] }>("GET", `/crm/v3/pipelines/contacts/${PIPELINE}`);
    console.log(`\nLifecycle stages now: ${after.stages.sort((a, b) => a.displayOrder - b.displayOrder).map((s) => s.label).join(", ")}`);
  } else {
    console.log("\nNothing changed. Re-run with --apply to make these changes.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
