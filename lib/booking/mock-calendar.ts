/**
 * Mock calendar for simulation and zero-cost demos: Mon–Sat, 10:00–18:00 IST,
 * hourly consultations, ~40% of slots deterministically "busy", designers
 * assigned round-robin.
 */
import { istDate, istParts } from "../time/ist";
import type { BookingRequest, BookingResult, Calendar, EventType } from "./types";

export const DEMO_DESIGNERS = ["Asha Kulkarni", "Rohan Joshi", "Meera Iyer", "Kabir Shah"];

function busy(d: Date): boolean {
  const n = Math.floor(d.getTime() / 3_600_000);
  return (n * 2654435761) % 10 < 4;
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export class MockCalendar implements Calendar {
  readonly provider = "mock" as const;
  private next = 0;
  readonly bookings: BookingResult[] = [];

  constructor(private readonly designers = DEMO_DESIGNERS) {}

  async openSlots(_eventType: EventType, from: Date, to: Date): Promise<Date[]> {
    const out: Date[] = [];
    const earliest = from.getTime() + 2 * 3_600_000;
    for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) {
      const day = istDate(new Date(t));
      for (let h = 10; h <= 17; h++) {
        const slot = new Date(`${day}T${String(h).padStart(2, "0")}:00:00+05:30`);
        if (slot.getTime() < earliest || slot.getTime() > to.getTime()) continue;
        if (istParts(slot).weekday === 7 || busy(slot)) continue;
        if (this.bookings.some((b) => b.startUtc === slot.toISOString())) continue;
        out.push(slot);
      }
    }
    return out;
  }

  async book(req: BookingRequest): Promise<BookingResult> {
    const start = new Date(req.slot.startUtc);
    const result: BookingResult = {
      uid: `mock_${req.leadRef}_${start.getTime()}`,
      startUtc: start.toISOString(),
      endUtc: new Date(start.getTime() + 3_600_000).toISOString(),
      // Spread across designers deterministically per lead (each simulated call has its own calendar).
      designer: this.designers[(hash(req.leadRef) + this.next++) % this.designers.length],
      provider: "mock",
    };
    this.bookings.push(result);
    return result;
  }
}
