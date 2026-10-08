-- Deal health (deterministic rubric, lib/deal-health/score.ts — no LLM cost).
alter table leads add column deal_health_score integer check (deal_health_score between 0 and 100);
alter table leads add column deal_health_band text check (deal_health_band in ('high', 'medium', 'low'));
alter table leads add column deal_health_factors jsonb;
alter table leads add column researched_us text;
alter table leads add column referral text;

-- Who should review: designers (fit/scope) or admin/founder (commercial, exceptions).
alter table leads add column review_queue text not null default 'designer' check (review_queue in ('designer', 'admin'));

-- Why the AI answered: the office line forwards when busy/unanswered, and everything after hours.
alter table calls add column answer_reason text check (answer_reason in ('after_hours', 'overflow', 'direct'));
update calls set answer_reason = case when after_hours then 'after_hours' else 'overflow' end where answer_reason is null;

-- Callback leads may be decided too (helpdesk / dashboard).
alter table reviews drop constraint if exists reviews_decision_check;

-- Designers see only the designer review queue (admin-queue leads are founder-only) and their own leads.
create or replace function designer_can_see_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id
      and app_role() = 'designer'
      and ((l.status = 'review' and l.review_queue = 'designer') or l.assigned_designer_id = app_designer_id())
  )
$$;

-- Config: the user's decisions of 2026-10-08.
update config set value = 'true'::jsonb, needs_founder_signoff = false,
  description = 'Agent always asks for a ballpark budget (decided 2026-10-08). A refusal is accepted and never pushed.'
 where key = 'ASK_BUDGET';
