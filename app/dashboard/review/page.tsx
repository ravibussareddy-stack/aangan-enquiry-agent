import { freshFromCrm } from "@/lib/crm/stage-sync";
import Link from "next/link";
import { getViewer } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { labelFor } from "@/lib/intake/sheet";
import { decideReview, routeLeadAction } from "../actions";
import { label, when } from "../_components/format";

// Live, per-request data (session + database).
export const instant = false;

interface Row {
  id: string;
  name: string | null;
  phone: string;
  locality: string | null;
  scope_text: string | null;
  flags: string[];
  callback_window: string | null;
  reasons: string[] | null;
  missing: string[] | null;
  created_at: string;
}

const QUEUES = {
  designer: { title: "Designer review", where: "l.status = 'review' and l.review_queue = 'designer'", help: "Approve to trigger the booking call; reject to send the closing SMS." },
  admin: { title: "Admin review", where: "l.status = 'review' and l.review_queue = 'admin'", help: "Escalated for the founder / admin to decide." },
  callback: { title: "Callback needed", where: "l.status = 'callback'", help: "Not enough captured on the call — the helpdesk calls back, then routes the lead." },
} as const;

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = (await getViewer())!;
  await freshFromCrm(); // pick up stage changes made in HubSpot (throttled)
  const founder = viewer.role === "founder";
  const { q } = await searchParams;
  const frontdesk = viewer.role === "frontdesk";
  const queue = (founder && q && q in QUEUES ? q : frontdesk ? "callback" : "designer") as keyof typeof QUEUES;
  const { rows, counts } = await asUser(viewer.userId, async (c) => ({
    rows: (
      await c.query<Row>(
        `select l.id, l.name, l.phone, l.locality, l.scope_text, l.flags, l.callback_window, l.created_at::text,
                (select array_agg(x) from jsonb_array_elements_text(l.evaluation -> 'reasons') x) reasons,
                (select array_agg(x) from jsonb_array_elements_text(l.evaluation -> 'intake' -> 'missing') x) missing
           from leads l left join reviews r on r.lead_id = l.id
          where ${QUEUES[queue].where} and r.id is null
          order by l.created_at`,
      )
    ).rows,
    counts: (
      await c.query<{ q: string; n: number }>(
        `select case when l.status = 'callback' then 'callback' else l.review_queue end q, count(*)::int n
           from leads l left join reviews r on r.lead_id = l.id
          where l.status in ('review', 'callback') and r.id is null group by 1`,
      )
    ).rows,
  }));
  const count = (k: string) => counts.find((c) => c.q === k)?.n ?? 0;

  return (
    <main>
      <div className="filters">
        <h1 style={{ marginRight: "auto" }}>Review queue</h1>
        {founder && (
          <div className="seg" role="group" aria-label="Queue">
            {(Object.keys(QUEUES) as (keyof typeof QUEUES)[]).map((k) => (
              <Link key={k} href={`?q=${k}`} aria-current={k === queue}>
                {QUEUES[k].title} ({count(k)})
              </Link>
            ))}
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>{QUEUES[queue].help}</p>
      {!rows.length && <div className="card muted">Nothing waiting here.</div>}
      <div className="grid">
        {rows.map((r) => (
          <article key={r.id} className="card span-6">
            <div className="card-head">
              <h2>
                <Link href={`/dashboard/leads/${r.id}`}>{r.name ?? "Unknown caller"}</Link>
              </h2>
              <span className="muted small">{when(r.created_at)}</span>
            </div>
            <dl className="kv">
              {queue === "callback" && (
                <>
                  <dt>Phone</dt>
                  <dd className="num">{r.phone}</dd>
                  <dt>Call back</dt>
                  <dd>{r.callback_window ?? "no time given — office hours"}</dd>
                  <dt>Missing</dt>
                  <dd className="status-bad">{(r.missing ?? []).map(labelFor).join(", ") || "—"}</dd>
                </>
              )}
              <dt>Scope</dt>
              <dd>{r.scope_text || "—"}</dd>
              <dt>Location</dt>
              <dd>{r.locality ?? "—"}</dd>
              {queue !== "callback" && (
                <>
                  <dt>Why review</dt>
                  <dd>{(r.reasons ?? []).join("; ") || "—"}</dd>
                  <dt>Callback</dt>
                  <dd>{r.callback_window ?? "—"}</dd>
                </>
              )}
              <dt>Flags</dt>
              <dd>{r.flags.map(label).join(", ") || "—"}</dd>
            </dl>
            <div className="row" style={{ marginTop: 12 }}>
              <form action={decideReview} className="row">
                <input type="hidden" name="leadId" value={r.id} />
                <button className="btn good" name="decision" value="approved">{queue === "callback" ? "Qualified" : "Approve"}</button>
                <button className="btn bad" name="decision" value="rejected">{queue === "callback" ? "Decline" : "Reject"}</button>
              </form>
              <form action={routeLeadAction} className="row">
                <input type="hidden" name="leadId" value={r.id} />
                {queue !== "designer" && (founder || frontdesk) && <button className="btn" name="to" value="designer">→ Designer review</button>}
                {queue !== "admin" && <button className="btn" name="to" value="admin">→ Admin review</button>}
                {queue !== "callback" && (founder || frontdesk) && <button className="btn" name="to" value="callback">→ Callback</button>}
              </form>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
