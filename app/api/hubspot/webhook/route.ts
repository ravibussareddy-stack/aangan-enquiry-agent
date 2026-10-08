/**
 * HubSpot private-app webhook: deal.propertyChange on dealstage.
 * Moving a review lead's deal to "New qualified" approves it; "Declined" rejects it.
 * "Consultation held" / "Won" / "Lost" feed the funnel. Signature v3; idempotent per eventId.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { stageForId, verifyHubSpotSignatureV3 } from "@/lib/integrations/hubspot";
import { applyReviewDecision, routeLead } from "@/lib/review/decide";
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
      const lead = await db().query<{ id: string; status: string }>("select id, status from leads where hubspot_deal_id = $1", [String(ev.objectId)]);
      const row = lead.rows[0];
      if (!row || !stage) return;
      const awaiting = row.status === "review" || row.status === "callback";
      if (awaiting && (stage === "New qualified" || stage === "Declined")) {
        await applyReviewDecision({
          leadId: row.id,
          decision: stage === "New qualified" ? "approved" : "rejected",
          source: "hubspot",
          reviewer: "HubSpot",
          syncCrm: false,
        });
      }
      // Helpdesk / admins re-route in HubSpot: Service review → designers, Admin review → admin, Callback needed → helpdesk.
      if (awaiting && (stage === "Service review" || stage === "Admin review" || stage === "Callback needed")) {
        await routeLead({ leadId: row.id, to: stage === "Service review" ? "designer" : stage === "Admin review" ? "admin" : "callback", syncCrm: false });
      }
      if (stage === "Consultation held" || stage === "Won" || stage === "Lost") {
        await db().query(
          "update bookings set outcome = $2 where lead_id = $1 and status = 'booked'",
          [row.id, stage === "Consultation held" ? "held" : stage === "Won" ? "won" : "lost"],
        );
      }
    });
  }
  return NextResponse.json({ ok: true });
}
