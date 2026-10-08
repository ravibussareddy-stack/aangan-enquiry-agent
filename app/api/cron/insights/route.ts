import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { runInsights } from "@/lib/insights/narrative";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!authorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await runInsights({ triggeredBy: "cron" });
  return NextResponse.json({ id: res.id, claims: res.claims.length, cost_inr: res.costInr });
}
