export const inr = (n: number | null | undefined, digits = 2) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const dur = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export const secs = (s: number | null | undefined) => (s == null ? "—" : s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const when = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
