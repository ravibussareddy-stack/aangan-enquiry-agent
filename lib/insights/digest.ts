/** Daily 8am digest to the founder: yesterday's calls, bookings, review backlog, spend. */
import { sendEmail } from "../integrations/resend";
import { istDate } from "../time/ist";
import { getMetrics } from "./metrics";

const inr = (n: number | null) => (n == null ? "—" : `₹${n.toFixed(2)}`);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export async function sendDailyDigest(now = new Date()) {
  const today = new Date(`${istDate(now)}T00:00:00+05:30`);
  const from = new Date(today.getTime() - 86_400_000);
  const m = await getMetrics({ from, to: today, includeSimulated: true });
  const lines = [
    `Calls: ${m.overview.total_calls} (after hours ${pct(m.overview.after_hours_share)}, dropped ${m.overview.dropped_calls})`,
    `Qualified: ${m.funnel.qualified} · Booked: ${m.funnel.booked}`,
    `Declined: ${m.declines.map((d) => `${d.reason} ${d.n}`).join(", ") || "none"}`,
    `Review queue: ${m.approvals.queue_size}${m.approvals.oldest_age_h ? ` (oldest ${Math.round(m.approvals.oldest_age_h)} h)` : ""}`,
    `Complaints: ${m.quality.complaints} · Price-leak flags: ${m.quality.price_leaks}`,
    `Spend: ${inr(m.cost.total_inr)} (per booking ${inr(m.cost.per_booking_inr)}) · Month to date ${inr(m.cost.month_to_date_inr)}`,
  ];
  const link = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/dashboard` : "";
  return sendEmail({
    to: process.env.DIGEST_TO ?? "",
    subject: `Aangan enquiries — ${istDate(from)}`,
    text: [...lines, link].join("\n"),
    html: `<h2>Aangan enquiries — ${istDate(from)}</h2><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>${link ? `<p><a href="${link}">Open dashboard</a></p>` : ""}`,
  });
}
