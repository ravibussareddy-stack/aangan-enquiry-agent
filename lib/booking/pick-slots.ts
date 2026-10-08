import { istParts, speakableSlot } from "../time/ist";
import type { EventType, Slot } from "./types";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * Choose 2–3 slots to offer: honour a spoken preference (weekday names,
 * "weekend", "morning", "evening", "tomorrow") when possible, otherwise
 * spread across different days, earliest first.
 */
export function pickSlots(
  open: Date[],
  eventType: EventType,
  preference: string | null,
  now: Date,
  count = 3,
): Slot[] {
  const pref = (preference ?? "").toLowerCase();
  const wantDays = WEEKDAYS.map((d, i) => (pref.includes(d) || pref.includes(d.slice(0, 3)) ? i + 1 : 0)).filter(Boolean);
  if (/weekend/.test(pref)) wantDays.push(6, 7);
  const tomorrow = istParts(new Date(now.getTime() + 86_400_000));
  const filters: ((d: Date) => boolean)[] = [];
  if (wantDays.length) filters.push((d) => wantDays.includes(istParts(d).weekday));
  if (/tomorrow|kal\b/.test(pref)) filters.push((d) => istParts(d).d === tomorrow.d && istParts(d).m === tomorrow.m);
  if (/morning|subah/.test(pref)) filters.push((d) => istParts(d).hh < 13);
  if (/afternoon/.test(pref)) filters.push((d) => istParts(d).hh >= 12 && istParts(d).hh < 16);
  if (/evening|shaam|after (5|6)/.test(pref)) filters.push((d) => istParts(d).hh >= 16);

  const sorted = [...open].sort((a, b) => a.getTime() - b.getTime());
  const preferred = sorted.filter((d) => filters.every((f) => f(d)));
  const pool = preferred.length ? preferred : sorted;

  const chosen: Date[] = [];
  const days = new Set<string>();
  for (const d of pool) {
    const key = `${istParts(d).m}-${istParts(d).d}`;
    if (days.has(key)) continue;
    days.add(key);
    chosen.push(d);
    if (chosen.length === count) break;
  }
  for (const d of pool) {
    if (chosen.length === count) break;
    if (!chosen.includes(d)) chosen.push(d);
  }
  return chosen
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d, i) => ({ id: `s${i + 1}`, startUtc: d.toISOString(), label: speakableSlot(d), eventType }));
}
