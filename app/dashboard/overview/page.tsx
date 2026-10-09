import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/auth/viewer";
import { loadRuntimeConfig } from "@/lib/config/runtime";
import { voiceSpendSoFar } from "@/lib/cost/spend-cap";
import { freshFromCrm } from "@/lib/crm/stage-sync";
import { getMetrics, recentCalls } from "@/lib/insights/metrics";
import { latestInsights } from "@/lib/insights/narrative";
import { refreshInsights } from "../actions";
import { BarList, Funnel } from "../_components/charts";
import { dur, inr, label, pct, secs, when } from "../_components/format";
import { Greeting } from "../_components/greeting";
import { WindChime } from "../_components/wind-chime";
import { Kpi, money } from "../_components/kpi";
import { SafetyStrip } from "../_components/safety";

// Live, per-request data (session + database).
export const instant = false;

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
const IST_SHORT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const OUTCOME_ICON: Record<string, string> = { qualified: "✓", review: "?", callback: "↺", declined: "✕", complaint: "!", redirect: "→", message: "✉" };

/**
 * Founder overview — KPI first. The top answers "how much business is in the pipe,
 * is the AI catching enquiries we'd miss, are they turning into meetings, are we
 * fast enough, is it worth it" — each with its change vs the previous period and,
 * where the brief sets one, its target. Details sit below.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (viewer.role !== "founder") redirect(homeFor(viewer));
  await freshFromCrm(); // pick up stage changes made in HubSpot (throttled)
  const sp = await searchParams;
  const rangeKey = (sp.range && sp.range in RANGES ? sp.range : "30d") as keyof typeof RANGES;
  const includeSimulated = sp.sim !== "0";
  const href = (patch: Record<string, string>) => `?${new URLSearchParams({ range: rangeKey, sim: includeSimulated ? "1" : "0", ...patch })}`;

  return (
    <main>
      <Greeting name={viewer.name ?? viewer.email} sub="the numbers behind the business">
        <WindChime />
        <div className="seg" role="group" aria-label="Date range">
          {Object.keys(RANGES).map((k) => (
            <Link key={k} href={href({ range: k })} aria-current={k === rangeKey}>
              {k}
            </Link>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Simulated calls">
          <Link href={href({ sim: "1" })} aria-current={includeSimulated}>
            All calls
          </Link>
          <Link href={href({ sim: "0" })} aria-current={!includeSimulated}>
            Live only
          </Link>
        </div>
      </Greeting>

      <Suspense
        key={`${rangeKey}-${includeSimulated}`}
        fallback={<div className="card skeleton" style={{ height: 640 }} aria-busy="true" aria-label="Loading KPIs" />}
      >
        <KpiBody rangeKey={rangeKey} includeSimulated={includeSimulated} insightsError={sp.insights_error} />
      </Suspense>
    </main>
  );
}

/** Everything below the header — streamed, so the header and range switches show at once. */
async function KpiBody({ rangeKey, includeSimulated, insightsError }: { rangeKey: keyof typeof RANGES; includeSimulated: boolean; insightsError?: string }) {
  const days = RANGES[rangeKey];
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  const [m, prev, insight, recent, voiceSpent, cfg] = await Promise.all([
    getMetrics({ from, to, includeSimulated }),
    getMetrics({ from: prevFrom, to: from, includeSimulated }),
    latestInsights(),
    recentCalls(includeSimulated),
    voiceSpendSoFar(),
    loadRuntimeConfig(),
  ]);
  const f = m.funnel;
  const b = m.business;
  const p = b.pipeline;
  const cap = cfg.voiceSpendCap.cap_inr;
  const vs = `vs previous ${rangeKey}`;
  const change = (now: number | null, before: number | null) => ({ now, before });
  const drop = f.biggest_drop;

  const sp = { insights_error: insightsError };

  return (
    <>
      {/* 0. Safety first */}
      <SafetyStrip q={m.quality} period={`last ${rangeKey}`} spend={{ used: voiceSpent, cap }} />

      {/* 1. Money — the one number to plan on */}
      <section id="pipeline" className="card" style={{ marginBottom: 18 }} aria-labelledby="pipe-h">
        <div className="hero">
          <div>
            <div className="label" id="pipe-h">
              Weighted pipeline · open qualified enquiries × likelihood to close
            </div>
            <div className="money">
              {money(p.weighted_inr)}
              <small>
                of {money(p.value_inr)} estimated across {p.open_deals} open deal{p.open_deals === 1 ? "" : "s"}
              </small>
            </div>
            <div className="split">
              <div className="mini">
                <div className="k">Added this period</div>
                <div className="v">{money(p.added_in_period_inr)}</div>
              </div>
              <div className="mini">
                <div className="k">Already booked</div>
                <div className="v">{money(p.booked_value_inr)}</div>
              </div>
              <div className="mini">
                <div className="k">Won</div>
                <div className="v">{money(p.won_value_inr)}</div>
              </div>
            </div>
            <p className="insight-line">
              Estimates use the caller&apos;s budget where given, otherwise the studio&apos;s typical range for their size; likelihood comes from deal health
              {p.unvalued ? ` · ${p.unvalued} deal${p.unvalued === 1 ? "" : "s"} without enough detail to value` : ""}.
            </p>
          </div>
          <div className="bubbles">
            <Link className="bubble" href="/dashboard/leads?status=qualified">
              <b>{f.qualified}</b>
              <span>Qualified</span>
            </Link>
            <Link className="bubble orb" href="/dashboard/leads">
              <b>{f.booked}</b>
              <span>Booked</span>
            </Link>
            <Link className="bubble" href="/dashboard/review">
              <b>{m.approvals.queue_size}</b>
              <span>To review</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 2. The KPIs that move the money, each vs the previous period */}
      <section className="kpis" aria-label="Key performance indicators" style={{ marginBottom: 18 }}>
        <Kpi
          label="Enquiries staff couldn't take"
          value={String(b.captured_outside_staff)}
          change={change(b.captured_outside_staff, prev.business.captured_outside_staff)}
          vs={vs}
          why={`After hours or while the line was busy — calls that would have gone to voicemail. ${pct(b.captured_outside_staff_share)} of all calls.`}
        />
        <Kpi
          label="Booking rate"
          value={pct(b.conversion.booking_rate)}
          change={change(b.conversion.booking_rate, prev.business.conversion.booking_rate)}
          vs={vs}
          why={`${f.booked} consultations from ${f.calls} calls · qualify rate ${pct(b.conversion.qualify_rate)}.`}
        />
        <Kpi
          label="Cost per booked consultation"
          value={inr(m.cost.per_booking_inr, 0)}
          change={change(m.cost.per_booking_inr, prev.cost.per_booking_inr)}
          lowerIsBetter
          vs={vs}
          why={`What the AI costs per meeting (incl. simulated calls at list price). ${inr(m.cost.per_qualified_inr, 0)} per qualified lead.`}
        />
        <Kpi
          label="Time to designer handoff"
          value={secs(m.quality.handoff_p50_s)}
          change={change(m.quality.handoff_p50_s, prev.quality.handoff_p50_s)}
          lowerIsBetter
          vs={vs}
          target={m.quality.handoff_p50_s == null ? null : m.quality.handoff_p50_s <= 120 ? "ok" : "warn"}
          targetText="target ≤ 2 min"
          why="Median from call end to the designer's email — leads go cold fast."
        />
        <Kpi
          label="Review backlog"
          value={String(m.approvals.queue_size)}
          change={change(m.approvals.queue_size, prev.approvals.queue_size)}
          lowerIsBetter
          vs={vs}
          target={m.approvals.oldest_age_h == null ? "ok" : m.approvals.oldest_age_h <= 24 ? "ok" : "warn"}
          targetText={m.approvals.oldest_age_h == null ? "nothing waiting" : `oldest ${Math.round(m.approvals.oldest_age_h)} h · target < 24 h`}
          why={`${m.approvals.designer_queue} designer · ${m.approvals.admin_queue} admin · ${m.approvals.callback_queue} callback.`}
        />
        <Kpi
          label="Avg call length"
          value={dur(m.overview.avg_duration_s)}
          change={change(m.overview.avg_duration_s, prev.overview.avg_duration_s)}
          lowerIsBetter
          vs={vs}
          target={m.overview.avg_duration_s == null ? null : m.overview.avg_duration_s <= 180 ? "ok" : "warn"}
          targetText="target ≤ 3:00"
          why={`Shorter calls cost less per lead. ${m.quality.calls_over_5_min} over 5 min.`}
        />
      </section>

      <div className="grid">
        <div className="span-8 stack">
          {/* 3. Where leads leak */}
          <section id="funnel" className="card" aria-labelledby="funnel-h">
            <div className="card-head">
              <div>
                <h2 id="funnel-h">Funnel — where enquiries drop off</h2>
                <div className="sub">
                  {drop ? `Biggest drop: ${label(drop.from)} → ${label(drop.to)} (${drop.lost} lost).` : "No drop-off yet."} Held / won come from HubSpot.
                </div>
              </div>
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
            <div className="split">
              <div className="mini">
                <div className="k">Show-up rate</div>
                <div className="v">{pct(b.conversion.show_rate)}</div>
              </div>
              <div className="mini">
                <div className="k">Win rate after meeting</div>
                <div className="v">{pct(b.conversion.win_rate)}</div>
              </div>
              <div className="mini">
                <div className="k">Approval rate (review)</div>
                <div className="v">{pct(m.approvals.approval_rate)}</div>
              </div>
            </div>
          </section>

          {/* 4. Biggest opportunities */}
          <section id="deal_health" className="card" aria-labelledby="deals-h">
            <div className="card-head">
              <div>
                <h2 id="deals-h">Biggest open opportunities</h2>
                <div className="sub">Ranked by estimated value × likelihood — call these first</div>
              </div>
              <Link className="pill ink sm" href="/dashboard/leads?status=qualified">
                All qualified
              </Link>
            </div>
            <div className="list">
              {p.top.map((d) => (
                <Link className="list-row" key={d.id} href={`/dashboard/leads/${d.id}`}>
                  <span className="ic" aria-hidden>
                    {(d.name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="name">{d.name ?? "Unknown caller"}</span>
                  <span className="meta">
                    {d.locality ?? "—"} · {d.value_inr ? `${money(d.value_inr)}${d.basis === "typical" ? " (typical)" : " (their budget)"}` : "not valued"}
                  </span>
                  <span className="badge">{d.booked ? "Booked" : "Not booked"}</span>
                  {d.score != null ? (
                    <span className={`badge health-${d.band}`}>
                      {d.score} · {label(String(d.band))}
                    </span>
                  ) : (
                    <span className="badge">no score</span>
                  )}
                </Link>
              ))}
              {!p.top.length && <p className="muted small">No open qualified deals yet.</p>}
            </div>
          </section>

          {/* 5. Demand */}
          <section id="demand" className="card" aria-labelledby="demand-h">
            <div className="card-head">
              <div>
                <h2 id="demand-h">Where demand comes from — and what we turn away</h2>
                <div className="sub">For marketing spend and where to grow next</div>
              </div>
            </div>
            <div className="grid">
              <div className="span-6">
                <h3 style={{ marginBottom: 10 }}>Top localities</h3>
                <BarList data={b.demand.localities.map((x) => ({ label: x.locality, value: x.n }))} empty="No enquiries yet." />
                <h3 style={{ margin: "16px 0 10px" }}>Project mix</h3>
                <BarList data={b.demand.project_mix.map((x) => ({ label: label(x.type), value: x.n }))} empty="No enquiries yet." />
              </div>
              <div id="declines" className="span-6">
                <h3 style={{ marginBottom: 10 }}>Declined — demand turned away</h3>
                <BarList data={m.declines.map((d) => ({ label: label(d.reason), value: d.n }))} empty="No declines in this period." />
                <p className="insight-line">
                  A recurring decline reason (e.g. area or category) is a signal: a new service zone or offering, or a referral partner.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="span-4 stack">
          {/* AI narrative over the same KPIs */}
          <section className="card ai" aria-labelledby="ai-h">
            <div className="card-head">
              <div>
                <h2 id="ai-h">AI summary</h2>
                <div className="sub">{insight ? `Updated ${when(insight.created_at)}` : "Not generated yet"} · refreshes daily at 10 pm</div>
              </div>
              <form action={refreshInsights}>
                <button className="icon-btn" type="submit" title="Refresh now" aria-label="Refresh AI summary now">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                    <path d="M20 4v7h-7" />
                  </svg>
                </button>
              </form>
            </div>
            {sp.insights_error && <p className="error">{sp.insights_error}</p>}
            {insight ? (
              <ul className="claims">
                {insight.narrative.slice(0, 5).map((c, i) => (
                  <li key={i}>
                    <span className="dot" aria-hidden />
                    <span>
                      {c.verified === false ? <span className="unverified">Unverified figure — see the {label(c.panel)} panel. </span> : c.text}{" "}
                      <a href={`#${c.panel}`} className="small">
                        {label(c.panel)}
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub">The first summary runs tonight at 10 pm, or press refresh.</p>
            )}
          </section>

          {/* Recent calls */}
          <section className="card" aria-labelledby="recent-h">
            <div className="card-head">
              <div>
                <h2 id="recent-h">Recent calls</h2>
                <div className="sub">Latest enquiries the AI answered</div>
              </div>
              <Link className="pill ink sm" href="/dashboard/leads">
                View all
              </Link>
            </div>
            <div className="list">
              {recent.map((c) => {
                const row = (
                  <>
                    <span className="ic" aria-hidden>
                      {OUTCOME_ICON[c.outcome ?? ""] ?? "·"}
                    </span>
                    <span className="name">{c.name ?? "Unknown caller"}</span>
                    <span className="meta">{IST_SHORT.format(new Date(c.started_at))}</span>
                    <span className={`badge ${c.outcome ?? ""}`}>{c.outcome ? label(c.outcome) : "No lead"}</span>
                    <span className="end small">{dur(c.duration_s)}</span>
                  </>
                );
                return c.lead_id ? (
                  <Link className="list-row" key={c.id} href={`/dashboard/leads/${c.lead_id}`}>
                    {row}
                  </Link>
                ) : (
                  <div className="list-row" key={c.id}>
                    {row}
                  </div>
                );
              })}
              {!recent.length && <p className="muted small">No calls yet.</p>}
            </div>
          </section>

          {/* Cost & spend */}
          <section id="cost" className="card" aria-labelledby="cost-h">
            <div className="card-head">
              <div>
                <h2 id="cost-h">Cost</h2>
                <div className="sub">
                  Period {inr(m.cost.total_inr)} · month to date {inr(m.cost.month_to_date_inr)}
                </div>
              </div>
            </div>
            <BarList data={m.cost.by_component.map((c) => ({ label: label(c.component), value: c.inr }))} format={(n) => inr(n)} />
            <h3 style={{ margin: "16px 0 6px" }}>Live voice spend</h3>
            <div className="mini">
              <div className="v">
                {inr(voiceSpent)} <span className="muted small">of {inr(cap, 0)} cap</span>
              </div>
            </div>
            <div className="meter" style={{ marginTop: 8 }} role="img" aria-label={`${Math.round((voiceSpent / cap) * 100)}% of the cap used`}>
              <span style={{ width: `${Math.min(100, Math.max(1, (voiceSpent / cap) * 100))}%` }} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
