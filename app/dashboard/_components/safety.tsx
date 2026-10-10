import Link from "next/link";
import type { Metrics } from "@/lib/insights/metrics";
import { secs } from "./format";

/**
 * Brand safety first: did the AI ever speak a price it shouldn't have, are complaints
 * reaching a senior quickly, are calls running long, is voice spend under the cap.
 */
export function SafetyStrip({ q, period, spend }: { q: Metrics["quality"]; period: string; spend?: { used: number } }) {
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
      href: "/dashboard/desk#complaints",
    },
    {
      label: "Calls over 5 min",
      value: String(q.calls_over_5_min),
      state: q.calls_over_5_min > 0 ? "warn" : "ok",
      note: "cost and caller patience",
      href: "/dashboard/overview#recent-h",
    },
    ...(spend
      ? [
          {
            label: "Live voice spend",
            value: `₹${spend.used.toFixed(2)}`,
            state: "ok",
            note: "total so far · no overall cap; each call is time-limited",
            href: "/dashboard/overview#cost",
          },
        ]
      : []),
  ] as { label: string; value: string; state: "ok" | "warn" | "bad"; note: string; href?: string }[];
  const flagged = items.filter((i) => i.state !== "ok");
  const issues = flagged.length;
  // The badge takes you straight to the first thing that needs you.
  const firstHref = flagged.find((i) => i.href)?.href;
  const badgeText = issues ? `${issues} need${issues === 1 ? "s" : ""} attention` : "✓ All clear";
  return (
    <section id="quality" className={`card safety ${issues ? "attention" : "clear"}`} aria-labelledby="safety-h" style={{ marginBottom: 18 }}>
      <div className="card-head" style={{ marginBottom: 10 }}>
        <div>
          <h2 id="safety-h">Safety</h2>
          <div className="sub">Brand and caller safety · {period}</div>
        </div>
        {firstHref ? (
          <Link
            href={firstHref}
            className="badge declined safety-jump has-tip"
            data-label={flagged.map((i) => i.label).join(" · ")}
            data-tip="Open what needs your attention"
          >
            {badgeText} →
          </Link>
        ) : (
          <span className={`badge ${issues ? "declined" : "qualified"}`}>{badgeText}</span>
        )}
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
            <Link key={i.label} href={i.href} className={`safety-item${i.state !== "ok" ? " needs" : ""}`}>
              {body}
              {i.state !== "ok" && <span className="go">Open →</span>}
            </Link>
          ) : (
            <div key={i.label} className="safety-item">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
