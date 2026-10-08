/** Asia/Kolkata helpers. All storage is UTC; all reasoning and display is IST. */

export const TZ = "Asia/Kolkata";

export interface OfficeHours {
  timezone: string;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  open: string; // "10:00"
  close: string; // "19:00"
}

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { y: +get("year"), m: +get("month"), d: +get("day"), hh: +get("hour"), mm: +get("minute"), weekday };
}

/** IST calendar date, e.g. "2026-10-07". */
export function istDate(d: Date): string {
  const p = parts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function isOfficeHours(d: Date, hours: OfficeHours): boolean {
  const p = parts(d);
  const minutes = p.hh * 60 + p.mm;
  const [oh, om] = hours.open.split(":").map(Number);
  const [ch, cm] = hours.close.split(":").map(Number);
  return hours.days.includes(p.weekday) && minutes >= oh * 60 + om && minutes < ch * 60 + cm;
}

/** Next moment the office opens (now, if open). */
export function nextOpening(d: Date, hours: OfficeHours): Date {
  if (isOfficeHours(d, hours)) return d;
  const [oh, om] = hours.open.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const day = new Date(d.getTime() + i * 86_400_000);
    const p = parts(day);
    const open = new Date(`${istDate(day)}T${String(oh).padStart(2, "0")}:${String(om).padStart(2, "0")}:00+05:30`);
    if (hours.days.includes(p.weekday) && open.getTime() > d.getTime()) return open;
  }
  return d;
}

/** "Thursday 8 October, 11 am" */
export function speakableSlot(d: Date): string {
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
  const p = parts(d);
  const h12 = p.hh % 12 || 12;
  const time = p.mm ? `${h12}:${String(p.mm).padStart(2, "0")}` : `${h12}`;
  return `${day}, ${time} ${p.hh < 12 ? "am" : "pm"}`;
}

/** "Wednesday 7 October 2026, 11:20 pm" */
export function nowForPrompt(d: Date): string {
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  const p = parts(d);
  return `${day}, ${p.hh % 12 || 12}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "am" : "pm"} IST`;
}

export function istParts(d: Date) {
  return parts(d);
}
