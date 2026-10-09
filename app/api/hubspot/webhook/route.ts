/**
 * HubSpot app webhook: deal.propertyChange on dealstage (legacy private or
 * project-based apps; service keys can't send webhooks, so lib/crm/stage-sync.ts
 * also pulls stages).
 * Moving a review lead's deal to "New qualified" approves it; "Declined" rejects it.
 * "Consultation held" / "Won" / "Lost" feed the funnel. Signature v3; idempotent per eventId.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { stageForId, verifyHubSpotSignatureV3 } from "@/lib/integrations/hubspot";
import { applyCrmStage } from "@/lib/crm/stage-sync";
import { once } from "@/lib/webhooks/idempotency";

interface HsEvent {
  eventId: number;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  subscriptionType: string;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const ok = verifyHubSpotSignatureV3({
    method: "POST",
    uri: req.url,
    rawBody,
    signature: req.headers.get("x-hubspot-signature-v3"),
    timestamp: req.headers.get("x-hubspot-request-timestamp"),
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
  });
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  for (const ev of JSON.parse(rawBody) as HsEvent[]) {
    if (ev.propertyName !== "dealstage" || !ev.propertyValue) continue;
    await once("hubspot", String(ev.eventId), ev, async () => {
      const stage = await stageForId(ev.propertyValue!);
      const lead = await db().query<{ id: string; status: string }>("select id, status::text from leads where hubspot_deal_id = $1", [String(ev.objectId)]);
      const row = lead.rows[0];
      if (!row || !stage) return;
      await applyCrmStage(row, stage);
      await db().query("update leads set hubspot_stage = $2 where id = $1", [row.id, stage]);
    });
  }
  return NextResponse.json({ ok: true });
}
