import { freshFromCrm } from "@/lib/crm/stage-sync";
import { hubspotDealUrl } from "@/lib/integrations/hubspot";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { decideReview, routeLeadAction } from "../../actions";
import { dur, inr, label, when } from "../../_components/format";
import { Status } from "../../_components/status";
import { INTAKE_FIELDS } from "@/lib/intake/sheet";
import type { LeadExtraction } from "@/lib/schema/lead";

// Live, per-request data (session + database).
export const instant = false;

interface Lead {
  id: string;
  status: string;
  decline_reason: string | null;
  name: string | null;
  phone: string;
  flags: string[];
  watch_for: string[];
  extraction: Record<string, unknown>;
  evaluation: { reasons?: string[]; intake?: { missing: string[]; not_known: string[] } };
  budget_floor_inr: number | null;
  budget_flag: string | null;
  transcript: string | null;
  duration_s: number | null;
  started_at: string;
  after_hours: boolean;
  price_leak: boolean;
  price_leak_hits: { text: string; pattern: string }[];
  is_simulated: boolean;
  hubspot_deal_id: string | null;
  hubspot_stage: string | null;
  review_queue: string;
  deal_health_score: number | null;
  deal_health_band: string | null;
  deal_health_factors: { key: string; label: string; points: number; max: number; reason: string }[] | null;
  answer_reason: string | null;
  callback_window: string | null;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = (await getViewer())!;
  await freshFromCrm(); // pick up stage changes made in HubSpot (throttled)
  const data = await asUser(viewer.userId, async (c) => {
    const lead = await c.query<Lead>(
      `select l.id, l.status, l.decline_reason, l.name, l.phone, l.flags, l.watch_for, l.extraction, l.evaluation,
              l.budget_floor_inr::float8 budget_floor_inr, l.budget_flag, l.hubspot_deal_id, l.hubspot_stage,
              l.review_queue, l.deal_health_score, l.deal_health_band, l.deal_health_factors, l.callback_window, c.answer_reason,
              c.transcript, c.duration_s, c.started_at::text, c.after_hours, c.price_leak, c.price_leak_hits, c.is_simulated
         from leads l join calls c on c.id = l.call_id where l.id = $1`,
      [id],
    );
    const criteria = await c.query<{ criterion: string; verdict: string; evidence: string; source: string }>(
      "select criterion, verdict, evidence, source from criteria where lead_id = $1 order by criterion",
      [id],
    );
    const bookings = await c.query<{ slot_start: string; designer: string | null; event_type: string; status: string; outcome: string | null }>(
      "select slot_start::text, designer, event_type, status, outcome from bookings where lead_id = $1",
      [id],
    );
    const review = await c.query<{ reviewer: string; decision: string; source: string; decided_at: string }>(
      "select reviewer, decision, source, decided_at::text from reviews where lead_id = $1",
      [id],
    );
    return { lead: lead.rows[0], criteria: criteria.rows, bookings: bookings.rows, review: review.rows[0] };
  });
  const l = data.lead;
  if (!l) notFound();
  const x = l.extraction as Record<string, string | number | boolean | null>;
  const turns = (l.transcript ?? "")
    .split("\n")
    .map((line) => line.match(/^(AGENT|USER):\s*(.*)$/))
    .filter(Boolean) as RegExpMatchArray[];
  const founder = viewer.role === "founder";

  return (
    <main>
      <div className="filters">
        <h1 style={{ marginRight: "auto" }}>{l.name ?? "Unknown caller"}</h1>
        <Status status={l.status} />
        {l.decline_reason && <span className="badge">{label(l.decline_reason)}</span>}
        {l.is_simulated && <span className="badge">simulated</span>}
      </div>
      <div className="grid">
        <section className="card span-4">
          <h2 style={{ marginBottom: 12 }}>Lead</h2>
          <dl className="kv">
            <dt>Phone</dt><dd className="num">{l.phone}</dd>
            <dt>Called</dt><dd>{when(l.started_at)}{l.answer_reason === "after_hours" ? " · after hours" : l.answer_reason === "overflow" ? " · staff busy (overflow)" : ""}</dd>
            <dt>Duration</dt><dd>{dur(l.duration_s)}</dd>
            <dt>Type</dt><dd>{label(String(x.project_type))} · {label(String(x.category))}</dd>
            <dt>Scope</dt><dd>{String(x.scope_text || "—")}</dd>
            <dt>Site</dt><dd>{[x.configuration, x.locality, x.pin].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Area</dt><dd>{x.carpet_sqft ? `${x.carpet_sqft} sq ft` : "—"}</dd>
            <dt>Timeline</dt><dd>{String(x.timeline_text ?? "—")}</dd>
            <dt>Decision</dt><dd>{label(String(x.decision_maker))}</dd>
            <dt>Budget</dt><dd>{x.budget_inr ? `${inr(Number(x.budget_inr), 0)}${x.budget_confirmed ? " (confirmed)" : ""}` : "not given"}</dd>
            {founder && (
              <>
                <dt>Floor (internal)</dt><dd>{l.budget_floor_inr ? `${inr(l.budget_floor_inr, 0)} · ${l.budget_flag}` : "—"}</dd>
              </>
            )}
            <dt>Seen our work</dt><dd>{label(String(x.researched_us ?? "unknown"))}{x.referral ? ` · referred: ${x.referral}` : ""}</dd>
            {l.callback_window && (<><dt>Call back</dt><dd>{l.callback_window}</dd></>)}
            <dt>Flags</dt><dd>{l.flags.map(label).join(", ") || "—"}</dd>
            <dt>Watch for</dt><dd>{l.watch_for.join("; ") || "—"}</dd>
            <dt>HubSpot</dt>
            <dd>
              {hubspotDealUrl(l.hubspot_deal_id) ? (
                <a href={hubspotDealUrl(l.hubspot_deal_id)!} target="_blank" rel="noreferrer">Open deal ↗</a>
              ) : (
                l.hubspot_deal_id ?? "—"
              )}
              {l.hubspot_stage ? ` · ${l.hubspot_stage}` : ""}
            </dd>
          </dl>
          {data.bookings.map((b) => (
            <p key={b.slot_start} className="notice" style={{ marginTop: 12 }}>
              Booked {label(b.event_type)} · {when(b.slot_start)}{b.designer ? ` with ${b.designer}` : ""} · {b.status}{b.outcome ? ` · ${b.outcome}` : ""}
            </p>
          ))}
          {data.review && (
            <p className="notice" style={{ marginTop: 12 }}>
              {label(data.review.decision)} by {data.review.reviewer} via {data.review.source} · {when(data.review.decided_at)}
            </p>
          )}
          {(l.status === "review" || l.status === "callback") && !data.review && (
            <>
              <p className="muted small" style={{ marginTop: 12 }}>
                {l.status === "callback" ? "Callback needed (helpdesk)" : `In ${l.review_queue} review`}
              </p>
              <form action={decideReview} className="row">
                <input type="hidden" name="leadId" value={l.id} />
                <button className="btn good" name="decision" value="approved">{l.status === "callback" ? "Qualified" : "Approve"}</button>
                <button className="btn bad" name="decision" value="rejected">{l.status === "callback" ? "Decline" : "Reject"}</button>
              </form>
              <form action={routeLeadAction} className="row" style={{ marginTop: 8 }}>
                <input type="hidden" name="leadId" value={l.id} />
                {founder && !(l.status === "review" && l.review_queue === "designer") && <button className="btn" name="to" value="designer">→ Designer review</button>}
                {!(l.status === "review" && l.review_queue === "admin") && <button className="btn" name="to" value="admin">→ Admin review</button>}
                {founder && l.status !== "callback" && <button className="btn" name="to" value="callback">→ Callback</button>}
              </form>
            </>
          )}
          {l.deal_health_factors && (
            <div style={{ marginTop: 16 }}>
              <h3>
                Deal health <span className={`badge health-${l.deal_health_band}`}>{l.deal_health_score}/100 · {label(String(l.deal_health_band))}</span>
              </h3>
              <table style={{ marginTop: 6 }}>
                <tbody>
                  {l.deal_health_factors.map((f) => (
                    <tr key={f.key} title={f.reason}>
                      <td className="small">{f.label}</td>
                      <td className="num small">{f.points}{f.max ? `/${f.max}` : ""}</td>
                      <td className="small muted">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Estimate from a fixed rubric (docs/deal-health-rubric.md).</p>
            </div>
          )}
        </section>

        <section className="card span-8">
          <h2 style={{ marginBottom: 12 }}>Intake sheet</h2>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table>
              <thead><tr><th>Field</th><th>Status</th><th>Question the agent asks</th></tr></thead>
              <tbody>
                {INTAKE_FIELDS.map((f) => {
                  const captured = f.postCall(l.extraction as unknown as LeadExtraction);
                  const notKnown = l.evaluation.intake?.not_known?.includes(f.key);
                  const missing = l.evaluation.intake?.missing?.includes(f.key);
                  return (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td className={captured ? "status-good" : missing ? "status-bad" : "muted"}>
                        {captured ? "✓ captured" : notKnown ? "? caller didn't know" : missing ? "✗ missing — ask" : "— not needed"}
                      </td>
                      <td className="small muted">{f.question}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginBottom: 12 }}>Criteria</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Criterion</th><th>Verdict</th><th>Evidence</th><th>Source</th></tr></thead>
              <tbody>
                {data.criteria.map((c) => (
                  <tr key={c.criterion}>
                    <td>{label(c.criterion)}</td>
                    <td className={c.verdict === "pass" ? "status-good" : c.verdict === "fail" ? "status-bad" : "status-warn"}>
                      {c.verdict === "pass" ? "✓ pass" : c.verdict === "fail" ? "✗ fail" : "? unclear"}
                    </td>
                    <td className="small">{c.evidence || "—"}</td>
                    <td className="muted small">{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {l.evaluation.reasons?.length ? <p className="muted small" style={{ marginTop: 8 }}>Decision: {l.evaluation.reasons.join("; ")}</p> : null}
          {l.price_leak && (
            <p className="error" style={{ marginTop: 8 }}>
              Price leak flagged: {l.price_leak_hits.map((h) => `"${h.text}" (${h.pattern})`).join(", ")}
            </p>
          )}

          <h2 style={{ margin: "20px 0 12px" }}>Transcript</h2>
          <div className="transcript">
            {turns.map((t, i) => (
              <div key={i} className={`turn ${t[1] === "AGENT" ? "agent" : "caller"}`}>
                <span className="who">{t[1] === "AGENT" ? "Agent" : "Caller"}</span>
                {t[2]}
              </div>
            ))}
            {!turns.length && <p className="muted small">No transcript.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
