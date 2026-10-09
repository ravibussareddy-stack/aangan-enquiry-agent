import { NextResponse } from "next/server";
import { pullCrmStages } from "@/lib/crm/stage-sync";
import { runSweep } from "@/lib/outbound/sweep";
import { authorizedCron } from "@/lib/cron";

export async function GET(req: Request) {
  if (!authorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Pull HubSpot stage changes first, so a lead approved in HubSpot gets its booking call in this run.
  const crm = await pullCrmStages({ minIntervalS: 30 });
  return NextResponse.json({ ...(await runSweep()), crm: { checked: crm.checked, changes: crm.changes.length, error: crm.error } });
}
