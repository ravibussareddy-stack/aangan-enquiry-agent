import { NextResponse } from "next/server";
import { runSweep } from "@/lib/outbound/sweep";
import { authorizedCron } from "@/lib/cron";

export async function GET(req: Request) {
  if (!authorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runSweep());
}
