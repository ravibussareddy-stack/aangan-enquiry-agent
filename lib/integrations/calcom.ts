/**
 * Cal.com API v2 calendar (https://cal.com/docs/api-reference/v2).
 * - Slots: GET /v2/slots (cal-api-version 2024-09-04)
 * - Bookings: POST /v2/bookings (cal-api-version 2024-08-13). Attendee email is
 *   required, so we use a studio-owned placeholder leads+<ref>@STUDIO_DOMAIN and
 *   keep the phone number on the booking; the customer is confirmed by SMS.
 * - Webhook signature: x-cal-signature-256 = HMAC-SHA256(raw body, secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BookingRequest, BookingResult, Calendar, EventType } from "../booking/types";
import { TZ } from "../time/ist";
import { fetchWithRetry } from "../http/retry";

const BASE = () => process.env.CALCOM_API_BASE ?? "https://api.cal.com/v2";

function eventTypeId(t: EventType): number {
  const env = {
    residential_consult: process.env.CALCOM_EVENT_TYPE_RESIDENTIAL,
    commercial_consult: process.env.CALCOM_EVENT_TYPE_COMMERCIAL,
    site_visit: process.env.CALCOM_EVENT_TYPE_SITE_VISIT,
  }[t];
  if (!env) throw new Error(`Cal.com event type for ${t} is not configured`);
  return Number(env);
}

export function calcomConfigured(): boolean {
  return !!(process.env.CALCOM_API_KEY && process.env.CALCOM_EVENT_TYPE_RESIDENTIAL);
}

export class CalcomCalendar implements Calendar {
  readonly provider = "calcom" as const;

  private headers(version: string) {
    return {
      authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
      "cal-api-version": version,
      "content-type": "application/json",
    };
  }

  async openSlots(eventType: EventType, from: Date, to: Date): Promise<Date[]> {
    const url = new URL(`${BASE()}/slots`);
    url.searchParams.set("eventTypeId", String(eventTypeId(eventType)));
    url.searchParams.set("start", from.toISOString());
    url.searchParams.set("end", to.toISOString());
    url.searchParams.set("timeZone", TZ);
    const res = await fetchWithRetry(url, { headers: this.headers("2024-09-04") });
    if (!res.ok) throw new Error(`Cal.com slots ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: Record<string, { start: string }[]> };
    return Object.values(json.data ?? {})
      .flat()
      .map((s) => new Date(s.start));
  }

  async book(req: BookingRequest): Promise<BookingResult> {
    const domain = process.env.STUDIO_DOMAIN ?? "example.com";
    const res = await fetchWithRetry(`${BASE()}/bookings`, {
      method: "POST",
      headers: this.headers("2024-08-13"),
      body: JSON.stringify({
        start: req.slot.startUtc,
        eventTypeId: eventTypeId(req.slot.eventType),
        attendee: {
          name: req.name,
          email: `leads+${req.leadRef}@${domain}`,
          timeZone: TZ,
          phoneNumber: req.phone,
          language: "en",
        },
        metadata: { lead_ref: req.leadRef, phone: req.phone, source: "aangan-voice-agent" },
        ...(req.notes ? { bookingFieldsResponses: { notes: req.notes.slice(0, 500) } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { data } = (await res.json()) as {
      data: { uid: string; start: string; end: string; hosts?: { name?: string; email?: string }[] };
    };
    return {
      uid: data.uid,
      startUtc: data.start,
      endUtc: data.end,
      designer: data.hosts?.[0]?.name ?? null,
      designerEmail: data.hosts?.[0]?.email ?? null,
      provider: "calcom",
    };
  }
}

export function verifyCalcomSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
