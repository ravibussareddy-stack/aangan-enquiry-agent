/**
 * Dashboard metrics — every number is computed here in SQL. Gemini insights
 * receive only this aggregated snapshot (never transcripts) and only narrate it.
 */
import { db } from "../db/client";

export interface Range {
  from: Date;
  to: Date;
  includeSimulated: boolean;
}

export interface Metrics {
  range: { from: string; to: string; includeSimulated: boolean };
  overview: {
    total_calls: number;
    after_hours_calls: number;
    overflow_calls: number;
    inbound_calls: number;
    after_hours_share: number | null;
    avg_duration_s: number | null;
    median_duration_s: number | null;
    answered_instantly_pct: number | null;
    dropped_calls: number;
    dropped_recovered: number;
  };
  funnel: { calls: number; qualified: number; booked: number; held: number; won: number; biggest_drop: { from: string; to: string; lost: number } | null };
  outcomes: Record<string, number>;
  approvals: {
    queue_size: number;
    designer_queue: number;
    admin_queue: number;
    callback_queue: number;
    oldest_age_h: number | null;
    decided: number;
    approved: number;
    approval_rate: number | null;
    avg_hours_to_decision: number | null;
  };
  bookings: {
    by_day: { day: string; n: number }[];
    by_designer: { designer: string; n: number }[];
    by_event_type: { event_type: string; n: number }[];
  };
  declines: { reason: string; n: number }[];
  cost: {
    by_component: { component: string; inr: number }[];
    total_inr: number;
    month_to_date_inr: number;
    per_call_inr: number | null;
    per_qualified_inr: number | null;
    per_booking_inr: number | null;
    real_voice_spend_inr: number;
  };
  deal_health: {
    by_band: { band: string; n: number; avg_score: number }[];
    /** Actual outcomes per band (from HubSpot / Cal.com) — calibrates the rubric. */
    win_rate_by_band: { band: string; decided: number; won: number }[];
    open_deals: { id: string; name: string | null; score: number; band: string; booked: boolean; locality: string | null }[];
  };
  quality: {
    price_leaks: number;
    guard_rewrites: number;
    complaints: number;
    avg_complaint_alert_s: number | null;
    calls_over_5_min: number;
    handoff_p50_s: number | null;
    handoff_max_s: number | null;
    asked_about_price: number;
  };
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function getMetrics(r: Range): Promise<Metrics> {
  const p = [r.from, r.to, r.includeSimulated];
  const callsWhere = "c.started_at >= $1 and c.started_at < $2 and ($3 or not c.is_simulated)";
  const q = <T extends Record<string, unknown>>(sql: string) => db().query<T>(sql, p).then((x) => x.rows);

  const [overview, funnel, outcomes, approvals, byDay, byDesigner, byType, declines, costBy, mtd, quality, voiceSpend, healthBands, healthWins, openDeals] = await Promise.all([
    q(`select count(*)::int total,
              count(*) filter (where direction = 'inbound')::int inbound,
              count(*) filter (where answer_reason = 'after_hours')::int after_hours_calls,
              count(*) filter (where answer_reason = 'overflow')::int overflow_calls,
              avg(case when after_hours then 1.0 else 0 end) after_hours_share,
              avg(duration_s) avg_duration,
              percentile_cont(0.5) within group (order by duration_s) median_duration,
              avg(case when answered_at is not null and answered_at - started_at <= interval '5 seconds' then 1.0 else 0 end)
                filter (where direction = 'inbound') answered_instantly,
              count(*) filter (where dropped)::int dropped,
              count(*) filter (where dropped and exists (
                select 1 from outbound_attempts a where a.source_call_id = c.id and a.result in ('placed','simulated','answered','booked')))::int recovered
         from calls c where ${callsWhere}`),
    q(`select count(distinct c.id)::int calls,
              count(distinct l.id) filter (where l.status = 'qualified')::int qualified,
              count(distinct b.lead_id)::int booked,
              count(distinct b.lead_id) filter (where b.outcome in ('held','won','lost'))::int held,
              count(distinct b.lead_id) filter (where b.outcome = 'won')::int won
         from calls c left join leads l on l.call_id = c.id
         left join bookings b on b.lead_id = l.id and b.status <> 'cancelled'
        where ${callsWhere} and c.direction = 'inbound'`),
    q(`select l.status, count(*)::int n from leads l join calls c on c.id = l.call_id where ${callsWhere} group by 1`),
    q(`select count(*) filter (where l.status in ('review', 'callback') and rv.id is null)::int queue,
              count(*) filter (where l.status = 'review' and l.review_queue = 'designer' and rv.id is null)::int designer_queue,
              count(*) filter (where l.status = 'review' and l.review_queue = 'admin' and rv.id is null)::int admin_queue,
              count(*) filter (where l.status = 'callback' and rv.id is null)::int callback_queue,
              extract(epoch from now() - min(l.created_at) filter (where l.status = 'review' and rv.id is null)) / 3600 oldest_h,
              count(rv.id)::int decided,
              count(rv.id) filter (where rv.decision = 'approved')::int approved,
              avg(extract(epoch from rv.decided_at - l.created_at) / 3600) avg_h
         from leads l join calls c on c.id = l.call_id left join reviews rv on rv.lead_id = l.id
        where ${callsWhere} and (l.status in ('review', 'callback') or rv.id is not null)`),
    q(`select to_char(date_trunc('day', b.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as day, count(*)::int n
         from bookings b join leads l on l.id = b.lead_id join calls c on c.id = l.call_id
        where ${callsWhere} group by 1 order by 1`),
    q(`select coalesce(b.designer, 'Unassigned') designer, count(*)::int n
         from bookings b join leads l on l.id = b.lead_id join calls c on c.id = l.call_id
        where ${callsWhere} group by 1 order by 2 desc`),
    q(`select b.event_type, count(*)::int n
         from bookings b join leads l on l.id = b.lead_id join calls c on c.id = l.call_id
        where ${callsWhere} group by 1 order by 2 desc`),
    q(`select coalesce(l.decline_reason, 'unspecified') reason, count(*)::int n
         from leads l join calls c on c.id = l.call_id
        where ${callsWhere} and l.status = 'declined' group by 1 order by 2 desc`),
    q(`select cc.component, sum(cc.cost_inr)::float8 inr
         from call_costs cc left join calls c on c.id = cc.call_id left join insights i on i.id = cc.insight_id
        where (c.id is not null and ${callsWhere}) or (i.id is not null and i.created_at >= $1 and i.created_at < $2)
        group by 1 order by 2 desc`),
    db()
      .query<{ inr: number }>(
        `select coalesce(sum(cc.cost_inr), 0)::float8 inr from call_costs cc left join calls c on c.id = cc.call_id
          where cc.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
            and ($1 or c.id is null or not c.is_simulated)`,
        [r.includeSimulated],
      )
      .then((x) => x.rows),
    q(`select count(*) filter (where c.price_leak)::int leaks,
              coalesce(sum(jsonb_array_length(coalesce(s.state -> 'guardRewrites', '[]'::jsonb))), 0)::int rewrites,
              count(*) filter (where c.outcome = 'complaint')::int complaints,
              avg(extract(epoch from h.sent_at - coalesce(c.processed_at, c.ended_at))) filter (where c.outcome = 'complaint') complaint_alert_s,
              count(*) filter (where c.duration_s > 300)::int over5,
              percentile_cont(0.5) within group (order by extract(epoch from h.sent_at - coalesce(c.processed_at, c.ended_at))) handoff_p50,
              max(extract(epoch from h.sent_at - coalesce(c.processed_at, c.ended_at))) handoff_max,
              count(*) filter (where l.asked_about_price)::int asked_price
         from calls c
         left join leads l on l.call_id = c.id
         left join call_sessions s on s.provider_call_id = c.provider_call_id
         left join lateral (select min(sent_at) sent_at from handoffs where lead_id = l.id and channel not in ('hubspot', 'crm_mock')) h on true
        where ${callsWhere}`),
    db()
      .query<{ inr: number }>(
        `select coalesce(sum(cc.cost_inr), 0)::float8 inr from call_costs cc join calls c on c.id = cc.call_id
          where cc.component = 'voice_minutes' and not c.is_simulated`,
      )
      .then((x) => x.rows),
    q(`select l.deal_health_band band, count(*)::int n, round(avg(l.deal_health_score))::int avg_score
         from leads l join calls c on c.id = l.call_id
        where ${callsWhere} and l.status = 'qualified' and l.deal_health_band is not null group by 1`),
    q(`select l.deal_health_band band,
              count(*) filter (where b.outcome in ('won', 'lost'))::int decided,
              count(*) filter (where b.outcome = 'won')::int won
         from leads l join calls c on c.id = l.call_id left join bookings b on b.lead_id = l.id
        where ${callsWhere} and l.deal_health_band is not null group by 1`),
    q(`select l.id, l.name, l.deal_health_score score, l.deal_health_band band, l.locality,
              exists (select 1 from bookings b where b.lead_id = l.id and b.status <> 'cancelled') booked
         from leads l join calls c on c.id = l.call_id
        where ${callsWhere} and l.status = 'qualified' and l.deal_health_score is not null
          and not exists (select 1 from bookings b where b.lead_id = l.id and b.outcome in ('won', 'lost'))
        order by l.deal_health_score desc limit 8`),
  ]);

  const o = overview[0];
  const f = funnel[0];
  const a = approvals[0];
  const qy = quality[0];
  const totalCost = costBy.reduce((s, c) => s + Number(c.inr), 0);
  const per = (n: number) => (n ? totalCost / n : null);

  return {
    range: { from: r.from.toISOString(), to: r.to.toISOString(), includeSimulated: r.includeSimulated },
    overview: {
      total_calls: Number(o.total),
      inbound_calls: Number(o.inbound),
      after_hours_calls: Number(o.after_hours_calls),
      overflow_calls: Number(o.overflow_calls),
      after_hours_share: num(o.after_hours_share),
      avg_duration_s: num(o.avg_duration),
      median_duration_s: num(o.median_duration),
      answered_instantly_pct: num(o.answered_instantly),
      dropped_calls: Number(o.dropped),
      dropped_recovered: Number(o.recovered),
    },
    funnel: (() => {
      const steps: [string, number][] = [
        ["calls", Number(f.calls)],
        ["qualified", Number(f.qualified)],
        ["booked", Number(f.booked)],
        ["held", Number(f.held)],
        ["won", Number(f.won)],
      ];
      let biggest: { from: string; to: string; lost: number } | null = null;
      for (let i = 1; i < steps.length; i++) {
        const lost = steps[i - 1][1] - steps[i][1];
        if (lost > 0 && (!biggest || lost > biggest.lost)) biggest = { from: steps[i - 1][0], to: steps[i][0], lost };
      }
      return { calls: steps[0][1], qualified: steps[1][1], booked: steps[2][1], held: steps[3][1], won: steps[4][1], biggest_drop: biggest };
    })(),
    outcomes: Object.fromEntries(outcomes.map((x) => [String(x.status), Number(x.n)])),
    approvals: {
      queue_size: Number(a.queue),
      designer_queue: Number(a.designer_queue),
      admin_queue: Number(a.admin_queue),
      callback_queue: Number(a.callback_queue),
      oldest_age_h: num(a.oldest_h),
      decided: Number(a.decided),
      approved: Number(a.approved),
      approval_rate: Number(a.decided) ? Number(a.approved) / Number(a.decided) : null,
      avg_hours_to_decision: num(a.avg_h),
    },
    bookings: {
      by_day: byDay.map((x) => ({ day: String(x.day), n: Number(x.n) })),
      by_designer: byDesigner.map((x) => ({ designer: String(x.designer), n: Number(x.n) })),
      by_event_type: byType.map((x) => ({ event_type: String(x.event_type), n: Number(x.n) })),
    },
    declines: declines.map((x) => ({ reason: String(x.reason), n: Number(x.n) })),
    cost: {
      by_component: costBy.map((x) => ({ component: String(x.component), inr: Number(x.inr) })),
      total_inr: totalCost,
      month_to_date_inr: Number(mtd[0]?.inr ?? 0),
      per_call_inr: per(Number(o.total)),
      per_qualified_inr: per(Number(f.qualified)),
      per_booking_inr: per(Number(f.booked)),
      real_voice_spend_inr: Number(voiceSpend[0]?.inr ?? 0),
    },
    deal_health: {
      by_band: ["high", "medium", "low"].map((b) => {
        const r = healthBands.find((x) => x.band === b);
        return { band: b, n: Number(r?.n ?? 0), avg_score: Number(r?.avg_score ?? 0) };
      }),
      win_rate_by_band: ["high", "medium", "low"].map((b) => {
        const r = healthWins.find((x) => x.band === b);
        return { band: b, decided: Number(r?.decided ?? 0), won: Number(r?.won ?? 0) };
      }),
      open_deals: openDeals.map((d) => ({
        id: String(d.id),
        name: (d.name as string) ?? null,
        score: Number(d.score),
        band: String(d.band),
        booked: Boolean(d.booked),
        locality: (d.locality as string) ?? null,
      })),
    },
    quality: {
      price_leaks: Number(qy.leaks),
      guard_rewrites: Number(qy.rewrites),
      complaints: Number(qy.complaints),
      avg_complaint_alert_s: num(qy.complaint_alert_s),
      calls_over_5_min: Number(qy.over5),
      handoff_p50_s: num(qy.handoff_p50),
      handoff_max_s: num(qy.handoff_max),
      asked_about_price: Number(qy.asked_price),
    },
  };
}

export interface RecentCall {
  id: string;
  started_at: string;
  outcome: string | null;
  duration_s: number | null;
  answer_reason: string | null;
  name: string | null;
  lead_id: string | null;
  locality: string | null;
}

/** Latest calls for the overview's activity list. */
export async function recentCalls(includeSimulated: boolean, limit = 6): Promise<RecentCall[]> {
  const { rows } = await db().query<RecentCall>(
    `select c.id, c.started_at::text, c.outcome::text, c.duration_s, c.answer_reason, l.name, l.id lead_id, l.locality
       from calls c left join leads l on l.call_id = c.id
      where ($1 or not c.is_simulated)
      order by c.started_at desc limit $2`,
    [includeSimulated, limit],
  );
  return rows;
}
