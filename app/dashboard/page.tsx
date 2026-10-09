import { freshFromCrm } from "@/lib/crm/stage-sync";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/auth/viewer";
import { loadRuntimeConfig } from "@/lib/config/runtime";
import { voiceSpendSoFar } from "@/lib/cost/spend-cap";
import { getMetrics, recentCalls } from "@/lib/insights/metrics";
import { latestInsights } from "@/lib/insights/narrative";
import { refreshInsights } from "./actions";
import { BarList, Funnel, PillColumns, Tile } from "./_components/charts";
import { dur, inr, label, pct, secs, when } from "./_components/format";

// Live, per-request data (session + database).
export const instant = false;

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

const IST_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" });
const IST_DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const IST_SHORT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function greeting(now: Date) {
  const h = Number(IST_HOUR.format(now));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function firstName(name: string | null, email: string) {
  const raw = (name?.trim() || email.split("@")[0]).split(/[\s._-]+/)[0];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const OUTCOME_ICON: Record<string, string> = { qualified: "✓", review: "?", callback: "↺", declined: "✕", complaint: "!", redirect: "→", message: "✉" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (viewer.role !== "founder") redirect(homeFor(viewer));
  await freshFromCrm(); // pick up stage changes made in HubSpot (throttled)
  const sp = await searchParams;
  const rangeKey = (sp.range && sp.range in RANGES ? sp.range : "30d") as keyof typeof RANGES;
  const includeSimulated = sp.sim !== "0";
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[rangeKey] * 86_400_000);
  const [m, insight, recent, voiceSpent, cfg] = await Promise.all([
    getMetrics({ from, to, includeSimulated }),
    latestInsights(),
    recentCalls(includeSimulated),
    voiceSpendSoFar(),
    loadRuntimeConfig(),
  ]);
  const href = (patch: Record<string, string>) => `?${new URLSearchParams({ range: rangeKey, sim: includeSimulated ? "1" : "0", ...patch })}`;
  const f = m.funnel;
  const cap = cfg.voiceSpendCap.cap_inr;

  return (
    <main>
      <header className="pagehead">
        <div>
          <h1>
            {greeting(to)}, {firstName(viewer.name, viewer.email)}
          </h1>
          <div className="sub">{IST_DATE.format(to)} · here&apos;s how the phone agent is doing</div>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Date range">
            {Object.keys(RANGES).map((k) => (
              <Link key={k} href={href({ range: k })} aria-current={k === rangeKey}>
                {k}
              </Link>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Simulated calls">
            <Link href={href({ sim: "1" })} aria-current={includeSimulated}>All calls</Link>
            <Link href={href({ sim: "0" })} aria-current={!includeSimulated}>Live only</Link>
          </div>
        </div>
      </header>

      <div className="grid">
        {/* Left column */}
        <div className="span-8" style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <section id="overview" className="card" aria-labelledby="hero-h">
            <div className="hero">
              <div>
                <div className="label" id="hero-h">Calls the AI handled · last {rangeKey}</div>
                <div className="big">
                  {m.overview.total_calls}
                  <small>
                    {m.overview.after_hours_calls} after hours · {m.overview.overflow_calls} staff busy
                  </small>
                </div>
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
              <div className="hero-actions">
                <Link className="pill" href="/dashboard/leads">View leads</Link>
                <Link className="pill ink" href="/dashboard/review">Open review queue</Link>
              </div>
            </div>
          </section>

          <div className="grid">
            <section id="bookings" className="card span-6">
              <div className="card-head">
                <div>
                  <h2>Bookings</h2>
                  <div className="sub">{f.booked} in the last {rangeKey}</div>
                </div>
                <span className="pill sm">{rangeKey === "7d" ? "Daily" : rangeKey === "30d" ? "Weekly" : "Fortnightly"}</span>
              </div>
              <PillColumns data={m.bookings.by_day} from={from} to={to} bucketDays={rangeKey === "7d" ? 1 : rangeKey === "30d" ? 7 : 14} />
            </section>

            <section className="card ai span-6" aria-labelledby="ai-h">
              <div className="card-head">
                <div>
                  <h2 id="ai-h">AI summary</h2>
                  <div className="sub">
                    {insight ? `Updated ${when(insight.created_at)}` : "Not generated yet"} · refreshes daily at 10 pm
                  </div>
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
                  {insight.narrative.slice(0, 4).map((c, i) => (
                    <li key={i}>
                      <span className="dot" aria-hidden />
                      <span>
                        {c.verified === false ? (
                          <span className="unverified">Unverified figure — see the {label(c.panel)} panel. </span>
                        ) : (
                          c.text
                        )}{" "}
                        <a href={`#${c.panel}`} className="small">{label(c.panel)}</a>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sub">The first summary runs tonight at 10 pm, or press refresh.</p>
              )}
            </section>
          </div>

          <section id="deal_health" className="card">
            <div className="card-head">
              <div>
                <h2>Open deals</h2>
                <div className="sub">Qualified & approved leads, by deal health (rubric, no AI cost)</div>
              </div>
              <Link className="pill ink sm" href="/dashboard/leads">View all</Link>
            </div>
            <div className="list">
              {m.deal_health.open_deals.slice(0, 5).map((d) => (
                <Link className="list-row" key={d.id} href={`/dashboard/leads/${d.id}`}>
                  <span className="ic" aria-hidden>{(d.name ?? "?").slice(0, 1).toUpperCase()}</span>
                  <span className="name">{d.name ?? "Unknown caller"}</span>
                  <span className="meta">{d.locality ?? "—"}</span>
                  <span className="badge">{d.booked ? "Booked" : "Not booked"}</span>
                  <span className={`badge health-${d.band}`}>{d.score} · {label(d.band)}</span>
                </Link>
              ))}
              {!m.deal_health.open_deals.length && <p className="muted small">No open qualified deals yet.</p>}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="span-4" style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <section className="card" aria-labelledby="recent-h">
            <div className="card-head">
              <div>
                <h2 id="recent-h">Recent calls</h2>
                <div className="sub">Latest enquiries the AI answered</div>
              </div>
              <Link className="pill ink sm" href="/dashboard/leads">View all</Link>
            </div>
            <div className="list">
              {recent.map((c) => {
                const row = (
                  <>
                    <span className="ic" aria-hidden>{OUTCOME_ICON[c.outcome ?? ""] ?? "·"}</span>
                    <span className="name">{c.name ?? "Unknown caller"}</span>
                    <span className="meta">{IST_SHORT.format(new Date(c.started_at))}</span>
                    <span className={`badge ${c.outcome ?? ""}`}>{c.outcome ? label(c.outcome) : "No lead"}</span>
                    <span className="end small">{dur(c.duration_s)}</span>
                  </>
                );
                return c.lead_id ? (
                  <Link className="list-row" key={c.id} href={`/dashboard/leads/${c.lead_id}`}>{row}</Link>
                ) : (
                  <div className="list-row" key={c.id}>{row}</div>
                );
              })}
              {!recent.length && <p className="muted small">No calls yet. Run <code>npm run sim -- --persist</code> to add simulated ones.</p>}
            </div>
          </section>

          <section className="card" aria-labelledby="spend-h">
            <div className="card-head">
              <div>
                <h2 id="spend-h">Live voice spend</h2>
                <div className="sub">Vaani credit, hard cap for the case study</div>
              </div>
            </div>
            <div className="stat-big">
              {inr(voiceSpent)} <span className="muted small">of {inr(cap, 0)}</span>
            </div>
            <div className="meter" style={{ margin: "10px 0 14px" }} role="img" aria-label={`${Math.round((voiceSpent / cap) * 100)}% of the cap used`}>
              <span style={{ width: `${Math.min(100, Math.max(1, (voiceSpent / cap) * 100))}%` }} />
            </div>
            <div className="tiles">
              <Tile label="Per booking" value={inr(m.cost.per_booking_inr)} />
              <Tile label="Month to date" value={inr(m.cost.month_to_date_inr)} />
            </div>
          </section>
        </div>
      </div>

      <h2 className="section-label">Details</h2>
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
        </section>

        <section className="card span-6">
          <div className="card-head">
            <h2>Deal health by band</h2>
            <span className="muted small">actual win rate calibrates the rubric</span>
          </div>
          <BarList data={m.deal_health.by_band.map((b) => ({ label: `${label(b.band)} (avg ${b.avg_score || "—"})`, value: b.n }))} empty="No scored deals yet." />
          <table style={{ marginTop: 12 }}>
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
        </section>

        <section id="declines" className="card span-6">
          <div className="card-head">
            <h2>Declines by reason</h2>
            <span className="muted small">demand being turned away</span>
          </div>
          <BarList data={m.declines.map((d) => ({ label: label(d.reason), value: d.n }))} empty="No declines in this period." />
          <h3 style={{ margin: "18px 0 10px" }}>Bookings by designer</h3>
          <BarList data={m.bookings.by_designer.map((d) => ({ label: d.designer, value: d.n }))} empty="No bookings yet." />
        </section>

        <section id="cost" className="card span-6">
          <div className="card-head">
            <h2>Cost</h2>
            <span className="muted small">period total {inr(m.cost.total_inr)}</span>
          </div>
          <div className="tiles" style={{ marginBottom: 12 }}>
            <Tile label="Per call" value={inr(m.cost.per_call_inr)} />
            <Tile label="Per qualified" value={inr(m.cost.per_qualified_inr)} />
            <Tile label="Per booking" value={inr(m.cost.per_booking_inr)} />
          </div>
          <BarList data={m.cost.by_component.map((c) => ({ label: label(c.component), value: c.inr }))} format={(n) => inr(n)} />
          {includeSimulated && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Simulated calls are costed at list rates (notional); no Vaani credit was used for them.
            </p>
          )}
        </section>

        <section id="quality" className="card span-6">
          <h2 style={{ marginBottom: 12 }}>Quality</h2>
          <div className="tiles">
            <Tile label="Price-leak flags" value={String(m.quality.price_leaks)} sub={`${m.quality.guard_rewrites} caught by guard`} />
            <Tile label="Asked about price" value={String(m.quality.asked_about_price)} sub="given the typical range" />
            <Tile label="Complaints" value={String(m.quality.complaints)} sub={`alert in ${secs(m.quality.avg_complaint_alert_s)}`} />
            <Tile label="Avg call" value={dur(m.overview.avg_duration_s)} sub="target ≤ 3:00" />
            <Tile label="Handoff time" value={secs(m.quality.handoff_p50_s)} sub="median · target ≤ 2 min" />
            <Tile label="Dropped recovered" value={`${m.overview.dropped_recovered}/${m.overview.dropped_calls}`} />
          </div>
        </section>
      </div>
    </main>
  );
}
