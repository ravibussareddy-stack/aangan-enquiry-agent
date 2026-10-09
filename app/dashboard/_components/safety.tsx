import Link from "next/link";
import type { Metrics } from "@/lib/insights/metrics";
import { secs } from "./format";

/**
 * Brand safety first: did the AI ever speak a price it shouldn't have, are complaints
 * reaching a senior quickly, are calls running long, is voice spend under the cap.
 */
export function SafetyStrip({ q, period, spend }: { q: Metrics["quality"]; period: string; spend?: { used: number; cap: number } }) {
  const items = [
    {
      label: "Prices spoken",
      value: String(q.price_leaks),
      state: q.price_leaks > 0 ? "bad" : "ok",
      note: q.price_leaks > 0 ? "review the flagged transcripts" : "no unapproved figure reached a caller",
      href: "/dashboard/leads",
    },
    {
      label: "Caught before speaking",
      value: String(q.guard_rewrites),
      state: "ok",
      note: "drafts the price guard replaced",
    },
    {
      label: "Complaints",
      value: String(q.complaints),
      state: q.complaints > 0 ? "warn" : "ok",
      note: q.complaints > 0 ? `senior alerted in ${secs(q.avg_complaint_alert_s)} — check they called back` : "none",
      href: "/dashboard/desk",
    },
    {
      label: "Calls over 5 min",
      value: String(q.calls_over_5_min),
      state: q.calls_over_5_min > 0 ? "warn" : "ok",
      note: "cost and caller patience",
    },
    ...(spend
      ? [
          {
            label: "Live voice spend",
            value: `₹${spend.used.toFixed(2)}`,
            state: spend.used >= spend.cap * 0.8 ? "warn" : "ok",
            note: `of ₹${spend.cap} cap — calls stop at the cap`,
          },
        ]
      : []),
  ] as { label: string; value: string; state: "ok" | "warn" | "bad"; note: string; href?: string }[];
  const issues = items.filter((i) => i.state !== "ok").length;
  return (
    <section id="quality" className={`card safety ${issues ? "attention" : "clear"}`} aria-labelledby="safety-h" style={{ marginBottom: 18 }}>
      <div className="card-head" style={{ marginBottom: 10 }}>
        <div>
          <h2 id="safety-h">Safety</h2>
          <div className="sub">Brand and caller safety · {period}</div>
        </div>
        <span className={`badge ${issues ? "declined" : "qualified"}`}>{issues ? `${issues} need${issues === 1 ? "s" : ""} attention` : "✓ All clear"}</span>
      </div>
      <div className="safety-row">
        {items.map((i) => {
          const body = (
            <>
              <span className="k">{i.label}</span>
              <span className={`v ${i.state}`}>{i.value}</span>
              <span className="n">{i.note}</span>
            </>
          );
          return i.href ? (
            <Link key={i.label} href={i.href} className="safety-item">{body}</Link>
          ) : (
            <div key={i.label} className="safety-item">{body}</div>
          );
        })}
      </div>
    </section>
  );
}
