/**
 * Signals: things the founder should act on, detected in SQL from live data.
 * They ground the AI recommendations — Gemini may only phrase these (with their
 * figures), never invent its own — and they double as the fallback wording.
 */
import { loadRuntimeConfig } from "../config/runtime";
import { db } from "../db/client";
import { closeProbability, estimateProjectValue } from "./value";

export interface Signal {
  /** Stable id: one recommendation per key (suppression and AI wording match on it). */
  key: string;
  /** 0–100: how urgent / valuable. */
  severity: number;
  /** Plain fallback wording (used until Gemini has phrased this signal). */
  title: string;
  /** One line of supporting detail. */
  why: string;
  href: string;
  /** Every number in title/why — the AI's figures are checked against these. */
  figures: number[];
  /** A customer's name, if the signal is about one lead. Never sent to Gemini: the AI sees "{lead}". */
  subject?: string;
}

/** Fill the {lead} placeholder (AI wording and titles keep names out of Gemini). */
export function withSubject(text: string, s: Pick<Signal, "subject">): string {
  return text.replaceAll("{lead}", s.subject ?? "your biggest open lead");
}

const lakh = (inr: number) => Math.round(inr / 1e5);

export async function detectSignals(): Promise<Signal[]> {
  const [cfg, review, callbacks, messages, load, stale, complaints, leaks, declines, deals] = await Promise.all([
    loadRuntimeConfig(),
    db().query<{ n: number; oldest_h: number | null; designer_n: number; admin_n: number }>(
      `select count(*)::int n, max(extract(epoch from now() - l.created_at) / 3600)::float8 oldest_h,
              count(*) filter (where l.review_queue = 'designer')::int designer_n, count(*) filter (where l.review_queue = 'admin')::int admin_n
         from leads l left join reviews r on r.lead_id = l.id
        where l.status = 'review' and r.id is null and l.created_at < now() - interval '24 hours'`,
    ),
    db().query<{ n: number; oldest_h: number | null }>(
      `select count(*)::int n, max(extract(epoch from now() - l.created_at) / 3600)::float8 oldest_h
         from leads l left join reviews r on r.lead_id = l.id where l.status = 'callback' and r.id is null`,
    ),
    db().query<{ n: number; oldest_h: number | null }>(
      "select count(*)::int n, max(extract(epoch from now() - created_at) / 3600)::float8 oldest_h from call_messages where not done",
    ),
    db().query<{ designer: string; n: number }>(
      `select coalesce(b.designer, 'Unassigned') designer, count(*)::int n from bookings b
        where b.status = 'booked' and b.slot_start between now() and now() + interval '7 days' group by 1 order by 2 desc`,
    ),
    db().query<{ n: number }>(
      "select count(*)::int n from bookings where status = 'booked' and outcome is null and coalesce(slot_end, slot_start) < now() - interval '1 day'",
    ),
    db().query<{ n: number }>("select count(*)::int n from leads where status = 'complaint' and created_at > now() - interval '7 days'"),
    db().query<{ n: number }>("select count(*)::int n from calls where price_leak and started_at > now() - interval '7 days'"),
    db().query<{ reason: string; n: number }>(
      `select coalesce(decline_reason, 'unspecified') reason, count(*)::int n from leads
        where status = 'declined' and created_at > now() - interval '30 days' group by 1 order by 2 desc limit 1`,
    ),
    db().query<{ id: string; name: string | null; locality: string | null; budget_inr: number | null; project_type: string | null; scope_kind: string | null; sq_ft: number | null; rooms: number | null; configuration: string | null; score: number | null }>(
      `select l.id, l.name, l.locality, l.budget_inr::float8 budget_inr, l.project_type, l.scope_kind, l.sq_ft::float8 sq_ft, l.rooms,
              l.extraction ->> 'configuration' configuration, l.deal_health_score score
         from leads l
        where l.status = 'qualified' and l.created_at > now() - interval '60 days'
          and not exists (select 1 from bookings b where b.lead_id = l.id and b.status <> 'cancelled')`,
    ),
  ]);

  const out: Signal[] = [];
  const r = review.rows[0];
  if (r.n > 0) {
    const oldest = Math.round(r.oldest_h ?? 0);
    out.push({
      key: "review_overdue",
      severity: Math.min(95, 55 + r.n * 5 + Math.min(25, oldest / 4)),
      title: `Clear the review queue — ${r.n} lead${r.n === 1 ? "" : "s"} waiting over 24 hours (oldest ${oldest} h)`,
      why: `${r.designer_n} with designers, ${r.admin_n} with admin. Interior leads go cold within days.`,
      href: "/dashboard/review",
      figures: [r.n, oldest, 24, r.designer_n, r.admin_n],
    });
  }
  const c = callbacks.rows[0];
  if (c.n > 0) {
    out.push({
      key: "callbacks_pending",
      severity: Math.min(90, 50 + c.n * 6),
      title: `Call back ${c.n} enquir${c.n === 1 ? "y" : "ies"} the AI couldn't complete`,
      why: "They're waiting on the helpdesk for a few missing details before a decision.",
      href: "/dashboard/desk",
      figures: [c.n],
    });
  }
  const m = messages.rows[0];
  if (m.n > 0) {
    out.push({
      key: "messages_open",
      severity: Math.min(70, 35 + m.n * 5),
      title: `Reply to ${m.n} open message${m.n === 1 ? "" : "s"} from callers`,
      why: "Existing clients and people who asked for a designer by name.",
      href: "/dashboard/messages",
      figures: [m.n],
    });
  }
  const busiest = load.rows[0];
  const quietest = load.rows.at(-1);
  if (busiest && quietest && load.rows.length > 1 && busiest.n >= 3 && busiest.n >= 2 * quietest.n) {
    out.push({
      key: "designer_load",
      severity: Math.min(75, 40 + (busiest.n - quietest.n) * 5),
      title: `Rebalance designers — ${busiest.designer} has ${busiest.n} consultations this week, ${quietest.designer} ${quietest.n}`,
      why: "Route new leads to the lighter calendar so response times and quality hold up.",
      href: "/dashboard/designer",
      figures: [busiest.n, quietest.n],
    });
  }
  const valued = deals.rows
    .map((d) => ({ d, est: estimateProjectValue({ budget_inr: d.budget_inr, project_type: d.project_type, scope_kind: d.scope_kind, carpet_sqft: d.sq_ft, rooms_in_scope: d.rooms, configuration: d.configuration }, cfg.typicalBudgets) }))
    .filter((x) => x.est)
    .sort((a, b) => b.est!.inr * closeProbability(b.d.score) - a.est!.inr * closeProbability(a.d.score));
  const top = valued[0];
  if (top) {
    const l = lakh(top.est!.inr);
    out.push({
      key: `book_top_deal:${top.d.id}`,
      severity: Math.min(85, 45 + Math.min(30, l / 3) + (top.d.score ?? 30) / 10),
      title: `Get {lead} booked — about ₹${l} lakh${top.d.locality ? `, ${top.d.locality}` : ""}, not booked yet`,
      subject: top.d.name ?? undefined,
      why: `Qualified but no consultation on the calendar${top.d.score != null ? ` · deal health ${top.d.score}/100` : ""}.`,
      href: `/dashboard/leads/${top.d.id}`,
      figures: [l, ...(top.d.score != null ? [top.d.score] : []), 100],
    });
  }
  const s = stale.rows[0];
  if (s.n > 0) {
    out.push({
      key: "outcomes_missing",
      severity: Math.min(60, 30 + s.n * 2),
      title: `Record outcomes for ${s.n} past consultation${s.n === 1 ? "" : "s"} (held / won / lost in HubSpot)`,
      why: "Without them, win rates and deal-health calibration stay guesswork.",
      href: "/dashboard/leads?status=qualified",
      figures: [s.n],
    });
  }
  const k = complaints.rows[0];
  if (k.n > 0) {
    out.push({
      key: "complaints_followup",
      severity: Math.min(90, 60 + k.n * 8),
      title: `Check a senior called back ${k.n} complaint${k.n === 1 ? "" : "s"} from the last 7 days`,
      why: "Existing clients complaining about their project — the brand risk is highest here.",
      href: "/dashboard/desk",
      figures: [k.n, 7],
    });
  }
  const pl = leaks.rows[0];
  if (pl.n > 0) {
    out.push({
      key: "price_leak_review",
      severity: 65,
      title: `Review ${pl.n} call${pl.n === 1 ? "" : "s"} flagged for a price mention this week`,
      why: "The pre-speech guard caught a figure; check the transcript wording.",
      href: "/dashboard/leads",
      figures: [pl.n],
    });
  }
  const d = declines.rows[0];
  if (d && d.n >= 3) {
    out.push({
      key: `decline_pattern:${d.reason}`,
      severity: 35 + Math.min(20, d.n * 2),
      title: `${d.n} enquiries declined for "${d.reason.replace(/_/g, " ")}" this month — worth a look`,
      why: "A recurring reason can mean a new service, area, or referral partner opportunity.",
      href: "/dashboard/overview#demand",
      figures: [d.n],
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
