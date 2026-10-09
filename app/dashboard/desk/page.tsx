import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { freshFromCrm } from "@/lib/crm/stage-sync";
import { asUser } from "@/lib/db/as-user";
import { labelFor } from "@/lib/intake/sheet";
import { decideReview, markMessageDone, routeLeadAction } from "../actions";
import { Greeting } from "../_components/greeting";
import { dur, label, when } from "../_components/format";

// Live, per-request data (session + database).
export const instant = false;

interface Callback { id: string; name: string | null; phone: string; locality: string | null; scope_text: string | null; callback_window: string | null; missing: string[] | null; created_at: string }
interface Complaint { id: string; name: string | null; phone: string; summary: string | null; callback_window: string | null; created_at: string }
interface Message { id: string; intent: string; caller_name: string | null; phone: string; for_name: string | null; about: string; callback_window: string | null; created_at: string }
interface Booking { lead_id: string; name: string | null; phone: string; designer: string | null; slot_start: string; event_type: string; locality: string | null }
interface Call { id: string; started_at: string; outcome: string | null; duration_s: number | null; name: string | null; lead_id: string | null; phone: string }

/**
 * Front desk / helpdesk: who to call back (not enough info, complaints,
 * messages), today's and tomorrow's consultations, and the latest calls.
 */
export default async function FrontDesk() {
  const viewer = (await getViewer())!;
  if (viewer.role === "designer") redirect("/dashboard/designer");
  await freshFromCrm();

  const data = await asUser(viewer.userId, async (c) => {
    const [callbacks, complaints, messages, bookings, calls] = await Promise.all([
      c.query<Callback>(
        `select l.id, l.name, l.phone, l.locality, l.scope_text, l.callback_window, l.created_at::text,
                (select array_agg(x) from jsonb_array_elements_text(l.evaluation -> 'intake' -> 'missing') x) missing
           from leads l left join reviews r on r.lead_id = l.id
          where l.status = 'callback' and r.id is null order by l.created_at limit 10`,
      ),
      c.query<Complaint>(
        // "What happened": the call summary, else the caller's own first words.
        `select l.id, l.name, l.phone, l.callback_window, l.created_at::text,
                coalesce(nullif(c.summary, ''), nullif(l.extraction ->> 'scope_text', ''),
                         nullif(substring(c.transcript from '(?:USER|CALLER): ([^\n]+)'), '')) summary
           from leads l join calls c on c.id = l.call_id
          where l.status = 'complaint' and l.created_at > now() - interval '7 days'
          order by l.created_at desc limit 6`,
      ),
      c.query<Message>(
        `select m.id, m.intent, m.caller_name, m.phone, coalesce(d.name, m.for_person) for_name, m.about, m.callback_window, m.created_at::text
           from call_messages m left join designers d on d.id = m.for_designer_id
          where not m.done order by m.created_at desc limit 8`,
      ),
      c.query<Booking>(
        `select b.lead_id, l.name, l.phone, b.designer, b.slot_start::text, b.event_type, l.locality
           from bookings b join leads l on l.id = b.lead_id
          where b.status = 'booked'
            and (b.slot_start at time zone 'Asia/Kolkata')::date between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 1
          order by b.slot_start limit 12`,
      ),
      c.query<Call>(
        `select c.id, c.started_at::text, c.outcome::text, c.duration_s, l.name, l.id lead_id, c.caller_phone phone
           from calls c left join leads l on l.call_id = c.id order by c.started_at desc limit 6`,
      ),
    ]);
    return { callbacks: callbacks.rows, complaints: complaints.rows, messages: messages.rows, bookings: bookings.rows, calls: calls.rows };
  });

  const todo = data.callbacks.length + data.complaints.length + data.messages.length;

  return (
    <main>
      <Greeting name={viewer.name ?? viewer.email} sub={viewer.role === "founder" ? "Previewing the front desk view" : `${todo} people to get back to`} />

      <section className="card" style={{ marginBottom: 18 }} aria-labelledby="todo-h">
        <div className="hero">
          <div>
            <div className="label" id="todo-h">To call back</div>
            <div className="big">
              {todo}
              <small>never promise a time — call as soon as possible, in their free window</small>
            </div>
          </div>
          <div className="bubbles">
            <a className="bubble" href="#callbacks"><b>{data.callbacks.length}</b><span>Need details</span></a>
            <a className="bubble orb" href="#complaints"><b>{data.complaints.length}</b><span>Complaints</span></a>
            <a className="bubble" href="#messages"><b>{data.messages.length}</b><span>Messages</span></a>
          </div>
        </div>
      </section>

      <div className="grid">
        <section id="callbacks" className="card span-7" aria-labelledby="cb-h">
          <div className="card-head">
            <div>
              <h2 id="cb-h">Callback needed</h2>
              <div className="sub">The AI couldn&apos;t capture enough — call, fill the gaps, then route</div>
            </div>
          </div>
          <div className="list">
            {data.callbacks.map((l) => (
              <div key={l.id} className="list-row" style={{ gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
                <div>
                  <Link className="name" href={`/dashboard/leads/${l.id}`}>{l.name ?? "Unknown caller"}</Link>{" "}
                  <span className="num muted small">{l.phone}</span>
                  <div className="meta" style={{ whiteSpace: "normal" }}>
                    {l.locality ?? "—"} · {l.scope_text ?? "scope not captured"} · free: {l.callback_window ?? "not given"}
                  </div>
                  <div className="small status-bad">Ask: {(l.missing ?? []).map(labelFor).join(", ") || "—"}</div>
                </div>
                <div className="row">
                  <form action={decideReview} className="row">
                    <input type="hidden" name="leadId" value={l.id} />
                    <button className="pill sm ink" name="decision" value="approved">Qualified</button>
                    <button className="pill sm" name="decision" value="rejected">Decline</button>
                  </form>
                  <form action={routeLeadAction} className="row">
                    <input type="hidden" name="leadId" value={l.id} />
                    <button className="pill sm" name="to" value="designer">→ Designers</button>
                    <button className="pill sm" name="to" value="admin">→ Admin</button>
                  </form>
                </div>
              </div>
            ))}
            {!data.callbacks.length && <p className="muted small">No callbacks waiting.</p>}
          </div>
        </section>

        <section id="complaints" className="card ai span-5" aria-labelledby="cp-h">
          <div className="card-head">
            <div>
              <h2 id="cp-h">Complaints (last 7 days)</h2>
              <div className="sub">A senior was emailed — make sure someone called</div>
            </div>
          </div>
          <ul className="claims">
            {data.complaints.map((c) => (
              <li key={c.id}>
                <span className="dot" aria-hidden />
                <span>
                  <Link href={`/dashboard/leads/${c.id}`}>{c.name ?? "Caller"}</Link> · <span className="num">{c.phone}</span> · {when(c.created_at)}
                  <span className="sub" style={{ display: "block" }}>
                    {c.summary ? `“${c.summary.length > 160 ? `${c.summary.slice(0, 157)}…` : c.summary}”` : "No description captured — open the lead."} Free: {c.callback_window ?? "not given"}
                  </span>
                </span>
              </li>
            ))}
            {!data.complaints.length && <li><span /><span className="sub">No complaints this week.</span></li>}
          </ul>
        </section>

        <section id="messages" className="card span-7" aria-labelledby="msg-h">
          <div className="card-head">
            <div>
              <h2 id="msg-h">Messages</h2>
              <div className="sub">Existing clients, people asking for a designer, and everything else</div>
            </div>
            <Link className="pill ink sm" href="/dashboard/messages">View all</Link>
          </div>
          <div className="list">
            {data.messages.map((m) => (
              <div className="list-row" key={m.id} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <span>
                  <span className="name">{m.caller_name ?? "Caller"} → {m.for_name ?? "Helpdesk"}</span> <span className="num muted small">{m.phone}</span>
                  <span className="meta" style={{ display: "block", whiteSpace: "normal" }}>
                    {label(m.intent.replace("existing_project_", "project "))} · {m.about} · free: {m.callback_window ?? "not given"}
                  </span>
                </span>
                <form action={markMessageDone}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="pill sm" type="submit">Done</button>
                </form>
              </div>
            ))}
            {!data.messages.length && <p className="muted small">No open messages.</p>}
          </div>
        </section>

        <section className="card span-5" aria-labelledby="bk-h">
          <div className="card-head">
            <div>
              <h2 id="bk-h">Consultations today & tomorrow</h2>
              <div className="sub">For walk-ins and reschedule calls</div>
            </div>
          </div>
          <div className="list">
            {data.bookings.map((b) => (
              <Link className="list-row" key={`${b.lead_id}${b.slot_start}`} href={`/dashboard/leads/${b.lead_id}`} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <span>
                  <span className="name">{b.name ?? "Caller"} with {b.designer ?? "a designer"}</span>
                  <span className="meta" style={{ display: "block" }}>{label(b.event_type)} · {b.locality ?? "—"}</span>
                </span>
                <span className="end small">{when(b.slot_start)}</span>
              </Link>
            ))}
            {!data.bookings.length && <p className="muted small">Nothing booked for today or tomorrow.</p>}
          </div>
          <h3 style={{ margin: "18px 0 8px" }}>Latest calls</h3>
          <div className="list">
            {data.calls.map((c) => {
              const row = (
                <>
                  <span className="name">{c.name ?? "Unknown caller"}</span>
                  <span className={`badge ${c.outcome ?? ""}`}>{c.outcome ? label(c.outcome) : "No lead"}</span>
                  <span className="end small">{dur(c.duration_s)}</span>
                </>
              );
              return c.lead_id ? (
                <Link className="list-row" key={c.id} href={`/dashboard/leads/${c.lead_id}`} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>{row}</Link>
              ) : (
                <div className="list-row" key={c.id} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>{row}</div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
