import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { freshFromCrm } from "@/lib/crm/stage-sync";
import { asUser } from "@/lib/db/as-user";
import { markMessageDone } from "../actions";
import { Greeting } from "../_components/greeting";
import { label, when } from "../_components/format";

// Live, per-request data (session + database).
export const instant = false;

interface Booking { lead_id: string; name: string | null; locality: string | null; scope_text: string | null; slot_start: string; event_type: string; phone: string }
interface Lead { id: string; name: string | null; locality: string | null; status: string; deal_health_score: number | null; deal_health_band: string | null; booked: boolean; created_at: string }
interface Review { id: string; name: string | null; locality: string | null; scope_text: string | null; created_at: string }
interface Message { id: string; caller_name: string | null; phone: string; about: string; callback_window: string | null; created_at: string }

/**
 * Designer's day: their consultations, the designer review queue, their leads
 * and messages left for them. The founder can open any designer's view (?d=).
 */
export default async function DesignerHome({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const viewer = (await getViewer())!;
  if (viewer.role === "frontdesk") redirect("/dashboard/desk");
  await freshFromCrm();
  const founder = viewer.role === "founder";
  const { d } = await searchParams;

  const data = await asUser(viewer.userId, async (c) => {
    const designers = (await c.query<{ id: string; name: string }>("select id, name from designers where active order by name")).rows;
    const designerId = founder ? (designers.find((x) => x.id === d)?.id ?? designers[0]?.id ?? null) : viewer.designerId;
    const me = designers.find((x) => x.id === designerId) ?? null;
    if (!designerId) return { designers, me, bookings: [], leads: [], reviews: [], messages: [] };
    const [bookings, leads, reviews, messages] = await Promise.all([
      c.query<Booking>(
        `select b.lead_id, l.name, l.locality, l.scope_text, b.slot_start::text, b.event_type, l.phone
           from bookings b join leads l on l.id = b.lead_id
          where (b.designer_id = $1 or l.assigned_designer_id = $1) and b.status = 'booked' and b.slot_start > now() - interval '2 hours'
          order by b.slot_start limit 8`,
        [designerId],
      ),
      c.query<Lead>(
        `select l.id, l.name, l.locality, l.status::text, l.deal_health_score, l.deal_health_band, l.created_at::text,
                exists (select 1 from bookings b where b.lead_id = l.id and b.status = 'booked') booked
           from leads l where l.assigned_designer_id = $1 order by l.created_at desc limit 8`,
        [designerId],
      ),
      c.query<Review>(
        `select l.id, l.name, l.locality, l.scope_text, l.created_at::text
           from leads l left join reviews r on r.lead_id = l.id
          where l.status = 'review' and l.review_queue = 'designer' and r.id is null
          order by l.created_at limit 5`,
      ),
      c.query<Message>(
        `select id, caller_name, phone, about, callback_window, created_at::text from call_messages
          where for_designer_id = $1 and not done order by created_at desc limit 6`,
        [designerId],
      ),
    ]);
    return { designers, me, bookings: bookings.rows, leads: leads.rows, reviews: reviews.rows, messages: messages.rows };
  });

  const firstName = founder ? (data.me?.name ?? "Designer") : (viewer.name ?? data.me?.name ?? viewer.email);

  return (
    <main>
      <Greeting name={firstName} sub={founder ? "Previewing a designer's view" : "Your consultations, reviews and messages"}>
        {founder && (
          <div className="seg" role="group" aria-label="Designer">
            {data.designers.map((x) => (
              <Link key={x.id} href={`?d=${x.id}`} aria-current={x.id === data.me?.id}>{x.name.split(" ")[0]}</Link>
            ))}
          </div>
        )}
      </Greeting>

      {!data.me && <div className="card muted">This account isn&apos;t linked to a designer yet.</div>}

      <div className="grid">
        <section className="card span-7" aria-labelledby="consult-h">
          <div className="card-head">
            <div>
              <h2 id="consult-h">Upcoming consultations</h2>
              <div className="sub">Booked by the AI or after review</div>
            </div>
          </div>
          <div className="list">
            {data.bookings.map((b) => (
              <Link className="list-row" key={`${b.lead_id}${b.slot_start}`} href={`/dashboard/leads/${b.lead_id}`}>
                <span className="ic" aria-hidden>{(b.name ?? "?").slice(0, 1)}</span>
                <span className="name">{b.name ?? "Unknown caller"}</span>
                <span className="meta">{b.locality ?? "—"} · {b.scope_text ?? ""}</span>
                <span className="badge">{label(b.event_type)}</span>
                <span className="end small">{when(b.slot_start)}</span>
              </Link>
            ))}
            {!data.bookings.length && <p className="muted small">No upcoming consultations.</p>}
          </div>
        </section>

        <section className="card ai span-5" aria-labelledby="rev-h">
          <div className="card-head">
            <div>
              <h2 id="rev-h">Waiting for a designer</h2>
              <div className="sub">Approve to trigger the booking call; reject sends a polite SMS</div>
            </div>
            <Link className="pill sm" href="/dashboard/review">Open queue</Link>
          </div>
          <ul className="claims">
            {data.reviews.map((r) => (
              <li key={r.id}>
                <span className="dot" aria-hidden />
                <span>
                  <Link href={`/dashboard/leads/${r.id}`}>{r.name ?? "Unknown caller"}</Link> · {r.locality ?? "—"} · {r.scope_text ?? "scope not captured"}
                  <span className="sub"> · {when(r.created_at)}</span>
                </span>
              </li>
            ))}
            {!data.reviews.length && <li><span /><span className="sub">Nothing waiting — all caught up.</span></li>}
          </ul>
        </section>

        <section className="card span-7" aria-labelledby="leads-h">
          <div className="card-head">
            <div>
              <h2 id="leads-h">My leads</h2>
              <div className="sub">Assigned to you, with deal health</div>
            </div>
            <Link className="pill ink sm" href="/dashboard/leads">View all</Link>
          </div>
          <div className="list">
            {data.leads.map((l) => (
              <Link className="list-row" key={l.id} href={`/dashboard/leads/${l.id}`}>
                <span className="ic" aria-hidden>{(l.name ?? "?").slice(0, 1)}</span>
                <span className="name">{l.name ?? "Unknown caller"}</span>
                <span className="meta">{l.locality ?? "—"}</span>
                <span className={`badge ${l.status}`}>{l.booked ? "Booked" : label(l.status)}</span>
                {l.deal_health_score != null ? <span className={`badge health-${l.deal_health_band}`}>{l.deal_health_score}</span> : <span />}
              </Link>
            ))}
            {!data.leads.length && <p className="muted small">No leads assigned yet.</p>}
          </div>
        </section>

        <section className="card span-5" aria-labelledby="msg-h">
          <div className="card-head">
            <div>
              <h2 id="msg-h">Messages for you</h2>
              <div className="sub">Callers who asked for you — call back as soon as possible</div>
            </div>
          </div>
          <div className="list">
            {data.messages.map((m) => (
              <div className="list-row" key={m.id} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <span>
                  <span className="name">{m.caller_name ?? "Caller"} · <span className="num">{m.phone}</span></span>
                  <span className="meta" style={{ display: "block", whiteSpace: "normal" }}>{m.about} · free: {m.callback_window ?? "not given"}</span>
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
      </div>
    </main>
  );
}
