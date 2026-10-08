import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getMetrics } from "@/lib/insights/metrics";
import { latestInsights } from "@/lib/insights/narrative";
import { refreshInsights } from "./actions";
import { BarList, DayColumns, Funnel, Tile } from "./_components/charts";
import { dur, inr, label, pct, secs, when } from "./_components/format";

// Live, per-request data (session + database).
export const instant = false;

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await getViewer();
  if (viewer?.role !== "founder") redirect("/dashboard/review");
  const sp = await searchParams;
  const rangeKey = (sp.range && sp.range in RANGES ? sp.range : "30d") as keyof typeof RANGES;
  const includeSimulated = sp.sim !== "0";
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[rangeKey] * 86_400_000);
  const [m, insight] = await Promise.all([getMetrics({ from, to, includeSimulated }), latestInsights()]);
  const href = (patch: Record<string, string>) => `?${new URLSearchParams({ range: rangeKey, sim: includeSimulated ? "1" : "0", ...patch })}`;
  const f = m.funnel;

  return (
    <main>
      <div className="filters">
        <h1 style={{ marginRight: "auto" }}>Overview</h1>
        <div className="seg" role="group" aria-label="Date range">
          {Object.keys(RANGES).map((k) => (
            <Link key={k} href={href({ range: k })} aria-current={k === rangeKey}>
              Last {k}
            </Link>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Simulated calls">
          <Link href={href({ sim: "1" })} aria-current={includeSimulated}>With simulated</Link>
          <Link href={href({ sim: "0" })} aria-current={!includeSimulated}>Live only</Link>
        </div>
      </div>

      <section className="card span-12" style={{ marginBottom: 16 }} aria-labelledby="insights-h">
        <div className="card-head">
          <h2 id="insights-h">This week, in brief</h2>
          <form action={refreshInsights}>
            <button className="btn" type="submit">Refresh</button>
          </form>
        </div>
        {sp.insights_error && <p className="error">{sp.insights_error}</p>}
        {insight ? (
          <>
            <ul className="claims">
              {insight.narrative.map((c, i) => (
                <li key={i}>
                  <span className="dot" aria-hidden />
                  <span>
                    {c.verified === false ? (
                      <span className="unverified">Unverified figure — showing the {c.panel} panel&apos;s numbers instead. </span>
                    ) : (
                      c.text
                    )}{" "}
                    <a href={`#${c.panel}`} className="small">{label(c.panel)} →</a>
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ marginTop: 10 }}>
              Generated {when(insight.created_at)} by {insight.model} ({insight.triggered_by}) · cost {inr(insight.cost_inr, 4)} · numbers computed in SQL, narrated by Gemini.
            </p>
          </>
        ) : (
          <p className="muted small">No insights yet — they run daily at 7:30 am, or press Refresh.</p>
        )}
      </section>

      <section id="overview" className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Calls the AI handled" value={String(m.overview.total_calls)} sub={`${m.overview.after_hours_calls} after hours · ${m.overview.overflow_calls} staff busy`} />
        <Tile label="After hours" value={pct(m.overview.after_hours_share)} sub="outside 10am–7pm, Mon–Sat" />
        <Tile label="Avg call" value={dur(m.overview.avg_duration_s)} sub={`median ${dur(m.overview.median_duration_s)} · target ≤ 3:00`} />
        <Tile label="Answered instantly" value={pct(m.overview.answered_instantly_pct)} sub="AI answers every call" />
        <Tile label="Dropped calls recovered" value={`${m.overview.dropped_recovered}/${m.overview.dropped_calls}`} sub="callback placed" />
        <Tile label="Spend (period)" value={inr(m.cost.total_inr)} sub={`real Vaani spend ${inr(m.cost.real_voice_spend_inr)}`} />
      </section>

      <div className="grid">
        <section id="funnel" className="card span-6">
          <div className="card-head">
            <h2>Funnel</h2>
            <span className="muted small">held / won come from HubSpot</span>
          </div>
          <Funnel
            steps={[
              { label: "Calls", value: f.calls },
              { label: "Qualified", value: f.qualified },
              { label: "Booked", value: f.booked },
              { label: "Consultation held", value: f.held },
              { label: "Won", value: f.won },
            ]}
          />
        </section>

        <section id="approvals" className="card span-6">
          <div className="card-head">
            <h2>Approvals</h2>
            <Link href="/dashboard/review" className="small">Open queue →</Link>
          </div>
          <div className="tiles">
            <Tile label="In queue" value={String(m.approvals.queue_size)} sub={`${m.approvals.designer_queue} designer · ${m.approvals.admin_queue} admin · ${m.approvals.callback_queue} callback`} />
            <Tile label="Approval rate" value={pct(m.approvals.approval_rate)} sub={`${m.approvals.approved}/${m.approvals.decided} decided`} />
            <Tile label="Time to decision" value={m.approvals.avg_hours_to_decision != null ? secs(m.approvals.avg_hours_to_decision * 3600) : "—"} sub="avg" />
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Approval rate tracks how well SCOPE_THRESHOLD (0.80) separates fits from non-fits — tune it in Settings.
          </p>
        </section>

        <section id="deal_health" className="card span-12">
          <div className="card-head">
            <h2>Deal health — qualified & approved leads</h2>
            <span className="muted small">estimated likelihood of winning · rubric, no AI cost</span>
          </div>
          <div className="grid">
            <div className="span-4">
              <BarList data={m.deal_health.by_band.map((b) => ({ label: `${label(b.band)} (avg ${b.avg_score || "—"})`, value: b.n }))} empty="No scored deals yet." />
              <h3 style={{ margin: "14px 0 6px" }}>Actual win rate by band</h3>
              <table>
                <thead><tr><th>Band</th><th>Won / decided</th></tr></thead>
                <tbody>
                  {m.deal_health.win_rate_by_band.map((b) => (
                    <tr key={b.band}>
                      <td>{label(b.band)}</td>
                      <td className="num">{b.decided ? `${b.won}/${b.decided} (${Math.round((b.won / b.decided) * 100)}%)` : "no outcomes yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 6 }}>Outcomes come from HubSpot (Won/Lost). If High doesn&apos;t beat Low, tune the rubric.</p>
            </div>
            <div className="span-8 table-wrap">
              <table>
                <thead><tr><th>Open deal</th><th>Area</th><th>Health</th><th>Booked</th></tr></thead>
                <tbody>
                  {m.deal_health.open_deals.map((d) => (
                    <tr key={d.id}>
                      <td><Link href={`/dashboard/leads/${d.id}`}>{d.name ?? "Unknown"}</Link></td>
                      <td>{d.locality ?? "—"}</td>
                      <td className="num"><span className={`badge health-${d.band}`}>{d.score} · {label(d.band)}</span></td>
                      <td>{d.booked ? "✓" : "—"}</td>
                    </tr>
                  ))}
                  {!m.deal_health.open_deals.length && <tr><td colSpan={4} className="muted">No open qualified deals.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="bookings" className="card span-8">
          <div className="card-head">
            <h2>Bookings by day</h2>
            <span className="muted small num">{f.booked} total</span>
          </div>
          <DayColumns data={m.bookings.by_day} from={from} to={to} />
        </section>

        <section className="card span-4">
          <h2 style={{ marginBottom: 12 }}>By designer</h2>
          <BarList data={m.bookings.by_designer.map((d) => ({ label: d.designer, value: d.n }))} empty="No bookings yet." />
          <h2 style={{ margin: "16px 0 12px" }}>By event type</h2>
          <BarList data={m.bookings.by_event_type.map((d) => ({ label: label(d.event_type), value: d.n }))} empty="No bookings yet." />
        </section>

        <section id="declines" className="card span-6">
          <div className="card-head">
            <h2>Declines by reason</h2>
            <span className="muted small">demand being turned away</span>
          </div>
          <BarList data={m.declines.map((d) => ({ label: label(d.reason), value: d.n }))} empty="No declines in this period." />
        </section>

        <section id="cost" className="card span-6">
          <div className="card-head">
            <h2>Cost</h2>
            <span className="muted small">month to date {inr(m.cost.month_to_date_inr)}</span>
          </div>
          <div className="tiles" style={{ marginBottom: 12 }}>
            <Tile label="Per call" value={inr(m.cost.per_call_inr)} />
            <Tile label="Per qualified" value={inr(m.cost.per_qualified_inr)} />
            <Tile label="Per booking" value={inr(m.cost.per_booking_inr)} />
          </div>
          <BarList data={m.cost.by_component.map((c) => ({ label: label(c.component), value: c.inr }))} format={(n) => inr(n)} />
          {includeSimulated && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Simulated calls are costed at list rates (notional) so cost per booking is meaningful; no Vaani credit was used.
            </p>
          )}
        </section>

        <section id="quality" className="card span-12">
          <h2 style={{ marginBottom: 12 }}>Quality</h2>
          <div className="tiles">
            <Tile label="Price-leak flags" value={String(m.quality.price_leaks)} sub={`${m.quality.guard_rewrites} caught by pre-speech guard`} />
            <Tile label="Asked about price" value={String(m.quality.asked_about_price)} sub="deflected, never disqualified" />
            <Tile label="Complaints" value={String(m.quality.complaints)} sub={`alert sent in ${secs(m.quality.avg_complaint_alert_s)}`} />
            <Tile label="Calls over 5 min" value={String(m.quality.calls_over_5_min)} />
            <Tile label="Handoff time" value={secs(m.quality.handoff_p50_s)} sub={`median · worst ${secs(m.quality.handoff_max_s)} · target ≤ 2 min`} />
          </div>
        </section>
      </div>
    </main>
  );
}
