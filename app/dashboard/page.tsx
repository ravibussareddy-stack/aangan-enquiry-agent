import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/auth/viewer";
import { freshFromCrm } from "@/lib/crm/stage-sync";
import { asUser } from "@/lib/db/as-user";
import { getMetrics } from "@/lib/insights/metrics";
import { latestInsights } from "@/lib/insights/narrative";
import { detectSignals, withSubject } from "@/lib/insights/signals";
import { addTodo, adoptRecommendation, deleteTodo, dismissRecommendation, refreshInsights, toggleTodo } from "./actions";
import { label, pct, when } from "./_components/format";
import { Greeting } from "./_components/greeting";
import { money } from "./_components/kpi";

// Live, per-request data (session + database).
export const instant = false;

interface Todo {
  id: string;
  text: string;
  source: "founder" | "ai";
  rec_key: string | null;
  href: string | null;
  due_on: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
}

const IST_DAY = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/**
 * The founder's landing page: a greeting, what changed (AI summary), what to do
 * (their own to-dos), and 3–4 recommendations grounded in live data — phrased by
 * Gemini each night, never repeating what's already on the list or was set aside.
 */
export default async function Today({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (viewer.role !== "founder") redirect(homeFor(viewer));
  await freshFromCrm();
  const sp = await searchParams;
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);

  const [insight, signals, week, lists] = await Promise.all([
    latestInsights(),
    detectSignals(),
    getMetrics({ from, to, includeSimulated: true }),
    asUser(viewer.userId, async (c) => ({
      todos: (
        await c.query<Todo>(
          `select id, text, source, rec_key, href, due_on::text, done, done_at::text, created_at::text from founder_todos
            where user_id = $1 and (not done or done_at > now() - interval '3 days')
            order by done, due_on nulls last, created_at desc limit 50`,
          [viewer.userId],
        )
      ).rows,
      suppressed: (
        await c.query<{ rec_key: string }>(
          `select rec_key from founder_todos where user_id = $1 and rec_key is not null and (not done or created_at > now() - interval '7 days')
           union select rec_key from recommendation_dismissals where user_id = $1 and dismissed_at > now() - interval '7 days'`,
          [viewer.userId],
        )
      ).rows.map((r) => r.rec_key),
    })),
  ]);

  // AI wording for a signal when the nightly run phrased it (and its figures checked out); else the plain wording.
  const aiText = new Map((insight?.recommendations ?? []).filter((r) => r.verified !== false).map((r) => [r.key, r.text]));
  const recs = signals
    .filter((s) => !lists.suppressed.includes(s.key))
    .slice(0, 4)
    .map((s) => ({ ...s, text: withSubject(aiText.get(s.key) ?? s.title, s), byAi: aiText.has(s.key) }));
  const open = lists.todos.filter((t) => !t.done);
  const done = lists.todos.filter((t) => t.done);
  const today = todayIst();
  const p = week.business.pipeline;

  return (
    <main>
      <Greeting
        name={viewer.name ?? viewer.email}
        sub={`${open.length ? `${open.length} thing${open.length === 1 ? "" : "s"} on your list` : "your list is clear"} · ${recs.length} suggestion${recs.length === 1 ? "" : "s"} from your assistant`}
      >
        <Link className="pill" href="/dashboard/overview">Open KPIs</Link>
      </Greeting>

      {/* At a glance — the three numbers that frame the day */}
      <section className="kpis" style={{ marginBottom: 18 }} aria-label="At a glance">
        <Link href="/dashboard/overview#pipeline" className="tile kpi" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="label"><span>Weighted pipeline</span></div>
          <div className="value">{money(p.weighted_inr)}</div>
          <div className="why">{p.open_deals} open deals · {money(p.added_in_period_inr)} added this week</div>
        </Link>
        <Link href="/dashboard/overview#funnel" className="tile kpi" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="label"><span>This week</span></div>
          <div className="value">{week.funnel.booked} booked</div>
          <div className="why">from {week.funnel.calls} calls · booking rate {pct(week.business.conversion.booking_rate)}</div>
        </Link>
        <Link href="/dashboard/review" className="tile kpi" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="label"><span>Waiting on the team</span></div>
          <div className="value">{week.approvals.queue_size}</div>
          <div className={`target ${week.approvals.oldest_age_h && week.approvals.oldest_age_h > 24 ? "warn" : "ok"}`}>
            {week.approvals.oldest_age_h ? `oldest ${Math.round(week.approvals.oldest_age_h)} h · target < 24 h` : "nothing overdue"}
          </div>
        </Link>
      </section>

      <div className="grid">
        <div className="span-7 stack">
          {/* AI recommendations */}
          <section className="card" aria-labelledby="recs-h">
            <div className="card-head">
              <div>
                <h2 id="recs-h">Suggested for today</h2>
                <div className="sub">From live data · worded by your AI assistant each night · add the ones you&apos;ll act on</div>
              </div>
            </div>
            <div className="list">
              {recs.map((r) => (
                <div key={r.key} className="list-row" style={{ gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
                  <div>
                    <div className="name" style={{ whiteSpace: "normal", fontWeight: 600 }}>
                      <span aria-hidden style={{ marginRight: 6 }}>✦</span>
                      {r.text}
                    </div>
                    <div className="meta" style={{ whiteSpace: "normal", marginTop: 4 }}>
                      {r.why}
                      {!r.byAi && <span title="Shown in plain wording until tonight's AI run covers it"> · plain wording</span>}
                    </div>
                  </div>
                  <div className="row">
                    <form action={adoptRecommendation}>
                      <input type="hidden" name="key" value={r.key} />
                      <input type="hidden" name="text" value={r.text} />
                      <input type="hidden" name="href" value={r.href} />
                      <button className="pill sm ink" type="submit">Add to my list</button>
                    </form>
                    <Link className="pill sm" href={r.href}>Open</Link>
                    <form action={dismissRecommendation}>
                      <input type="hidden" name="key" value={r.key} />
                      <button className="pill sm" type="submit" title="Hide for 7 days">Not now</button>
                    </form>
                  </div>
                </div>
              ))}
              {!recs.length && <p className="muted small">Nothing needs you right now — the queue is clear and no risks are flagged.</p>}
            </div>
          </section>

          {/* The founder's own list */}
          <section className="card" aria-labelledby="todo-h">
            <div className="card-head">
              <div>
                <h2 id="todo-h">My to-do list</h2>
                <div className="sub">Your own tasks, plus suggestions you&apos;ve added</div>
              </div>
            </div>
            <form action={addTodo} className="row" style={{ marginBottom: 12 }}>
              <input name="text" required maxLength={300} placeholder="Add a task — e.g. Call Priya about the Kothrud site visit" aria-label="New task" style={{ flex: "1 1 260px" }} />
              <input name="due_on" type="date" aria-label="Due date (optional)" style={{ width: 160 }} />
              <button className="pill ink" type="submit">Add</button>
            </form>
            <div className="list">
              {open.map((t) => (
                <div key={t.id} className="list-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto", alignItems: "center" }}>
                  <form action={toggleTodo}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="check" type="submit" aria-label={`Mark "${t.text}" done`} />
                  </form>
                  <span style={{ minWidth: 0 }}>
                    <span className="name" style={{ whiteSpace: "normal" }}>
                      {t.source === "ai" && <span aria-label="From your assistant" title="From your assistant" style={{ marginRight: 6 }}>✦</span>}
                      {t.href ? <Link href={t.href}>{t.text}</Link> : t.text}
                    </span>
                  </span>
                  {t.due_on ? (
                    <span className={`badge ${t.due_on < today ? "declined" : t.due_on === today ? "review" : ""}`}>
                      {t.due_on < today ? "overdue · " : t.due_on === today ? "today · " : ""}
                      {IST_DAY.format(new Date(`${t.due_on}T12:00:00+05:30`))}
                    </span>
                  ) : (
                    <span />
                  )}
                  <form action={deleteTodo}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="btn link" type="submit" aria-label={`Delete "${t.text}"`} title="Delete">✕</button>
                  </form>
                </div>
              ))}
              {!open.length && <p className="muted small">Nothing on your list. Add a task, or add one of the suggestions.</p>}
            </div>
            {done.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>Done recently ({done.length})</summary>
                <div className="list" style={{ marginTop: 6 }}>
                  {done.map((t) => (
                    <div key={t.id} className="list-row" style={{ gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", opacity: 0.65 }}>
                      <form action={toggleTodo}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="check done" type="submit" aria-label={`Mark "${t.text}" not done`} />
                      </form>
                      <span className="name" style={{ whiteSpace: "normal", textDecoration: "line-through" }}>{t.text}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        </div>

        <div className="span-5 stack">
          {/* What changed */}
          <section className="card ai" aria-labelledby="ai-h">
            <div className="card-head">
              <div>
                <h2 id="ai-h">AI summary</h2>
                <div className="sub">{insight ? `Updated ${when(insight.created_at)}` : "Not generated yet"} · refreshes daily at 10 pm</div>
              </div>
              <form action={refreshInsights}>
                <button className="icon-btn" type="submit" title="Refresh now" aria-label="Refresh AI summary and suggestions now">
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
                      <Link href={`/dashboard/overview#${c.panel}`} className="small">{label(c.panel)}</Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub">The first summary runs tonight at 10 pm, or press refresh.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
