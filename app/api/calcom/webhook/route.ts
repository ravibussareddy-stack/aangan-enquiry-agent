/**
 * Cal.com booking webhooks → bookings table + HubSpot deal stage.
 * Signature: x-cal-signature-256 (HMAC-SHA256 of the raw body). Idempotent.
 */
import { NextResponse } from "next/server";
import { setLeadDealStage } from "@/lib/crm/stage-sync";
import { db } from "@/lib/db/client";
import { verifyCalcomSignature } from "@/lib/integrations/calcom";
import { once } from "@/lib/webhooks/idempotency";

interface CalEvent {
  triggerEvent: string;
  createdAt?: string;
  payload: {
    uid: string;
    startTime?: string;
    endTime?: string;
    metadata?: { lead_ref?: string };
    organizer?: { name?: string };
    noShowHost?: boolean;
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyCalcomSignature(rawBody, req.headers.get("x-cal-signature-256"), process.env.CALCOM_WEBHOOK_SECRET ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ev = JSON.parse(rawBody) as CalEvent;
  const p = ev.payload;
  await once("calcom", `${p.uid}:${ev.triggerEvent}:${ev.createdAt ?? ""}`, ev, async () => {
    const status =
      ev.triggerEvent === "BOOKING_CANCELLED" ? "cancelled" : ev.triggerEvent === "BOOKING_RESCHEDULED" ? "rescheduled" : null;
    if (ev.triggerEvent === "BOOKING_CREATED" && p.metadata?.lead_ref) {
      await db().query(
        `insert into bookings (lead_id, calcom_uid, event_type, designer, slot_start, slot_end, status)
         select l.id, $2, 'residential_consult', $3, $4, $5, 'booked' from leads l where l.id::text = $1
         on conflict (calcom_uid) do nothing`,
        [p.metadata.lead_ref, p.uid, p.organizer?.name ?? null, p.startTime, p.endTime],
      );
    }
    if (status) {
      await db().query("update bookings set status = $2, slot_start = coalesce($3, slot_start) where calcom_uid = $1", [p.uid, status, p.startTime ?? null]);
    }
    if (ev.triggerEvent === "MEETING_ENDED") await db().query("update bookings set outcome = coalesce(outcome, 'held') where calcom_uid = $1", [p.uid]);
    if (ev.triggerEvent === "NO_SHOW_UPDATED") await db().query("update bookings set outcome = 'no_show' where calcom_uid = $1", [p.uid]);

    const lead = await db().query<{ hubspot_deal_id: string | null; lead_id: string }>(
      "select l.hubspot_deal_id, l.id lead_id from bookings b join leads l on l.id = b.lead_id where b.calcom_uid = $1",
      [p.uid],
    );
    const dealId = lead.rows[0]?.hubspot_deal_id;
    if (lead.rows[0]) {
      const { recomputeDealHealth } = await import("@/lib/deal-health/store");
      await recomputeDealHealth(lead.rows[0].lead_id);
    }
    if (dealId) {
      const stage = ev.triggerEvent === "BOOKING_CREATED" || ev.triggerEvent === "BOOKING_RESCHEDULED" ? "Booked" : ev.triggerEvent === "MEETING_ENDED" ? "Consultation held" : null;
      if (stage) await setLeadDealStage(dealId, stage);
    }
  });
  return NextResponse.json({ ok: true });
}
