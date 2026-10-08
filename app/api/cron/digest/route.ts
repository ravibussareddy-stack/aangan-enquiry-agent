import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { sendDailyDigest } from "@/lib/insights/digest";

export async function GET(req: Request) {
  if (!authorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await sendDailyDigest());
}
