import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { pullCrmStages } from "@/lib/crm/stage-sync";
import { runInsights } from "@/lib/insights/narrative";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!authorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await pullCrmStages({ force: true }); // won/lost/held from HubSpot feed the funnel the summary narrates
  const res = await runInsights({ triggeredBy: "cron" });
  return NextResponse.json({ id: res.id, claims: res.claims.length, cost_inr: res.costInr });
}
