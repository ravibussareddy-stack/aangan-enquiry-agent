-- Aangan Studio — phone enquiry agent: core schema.
-- System of record (Neon Postgres). Webhooks and cron run as the database
-- owner; the dashboard runs as `app_user` with RLS (see 20261007000002_rls.sql).


-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type call_direction as enum ('inbound', 'outbound');
create type lead_status as enum ('qualified', 'review', 'declined', 'redirect', 'complaint');
create type criterion_verdict as enum ('pass', 'fail', 'unclear');
create type review_decision as enum ('approved', 'rejected');
create type review_source as enum ('telegram', 'hubspot', 'dashboard');
create type app_role as enum ('founder', 'designer');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table designers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  phone             text,
  telegram_user_id  bigint unique,          -- callback_query.from.id, for reviewer attribution
  telegram_chat_id  bigint,                 -- set when the designer presses Start on the bot
  calcom_user_id    integer unique,
  hubspot_owner_id  text unique,
  is_senior         boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- One row per dashboard login. user_id is the Neon Auth (Better Auth) user id.
create table profiles (
  user_id      text primary key,
  role         app_role not null,
  designer_id  uuid references designers (id),
  created_at   timestamptz not null default now(),
  constraint designer_role_has_designer check (role <> 'designer' or designer_id is not null)
);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create table calls (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'vaani',
  provider_call_id    text not null,
  direction           call_direction not null,
  caller_phone        text not null,              -- E.164
  started_at          timestamptz not null,
  answered_at         timestamptz,
  ended_at            timestamptz,
  duration_s          integer,
  after_hours         boolean not null default false,
  dropped             boolean not null default false,   -- caller hung up / line dropped mid-flow
  recovered_by_call_id uuid references calls (id),      -- outbound callback that recovered a dropped call
  transcript          text,                             -- "AGENT: … / USER: …"
  recording_url       text,
  summary             text,                             -- provider call summary ("Watch for")
  outcome             lead_status,
  price_leak          boolean not null default false,
  price_leak_hits     jsonb not null default '[]',      -- [{turn, text, pattern}]
  prompt_version      text,
  raw_payload         jsonb,
  created_at          timestamptz not null default now(),
  unique (provider, provider_call_id)
);
create index calls_started_at_idx on calls (started_at desc);
create index calls_caller_phone_idx on calls (caller_phone);

-- ---------------------------------------------------------------------------
-- Leads (channel-agnostic)
-- ---------------------------------------------------------------------------
create table leads (
  id                    uuid primary key default gen_random_uuid(),
  call_id               uuid references calls (id),
  channel               text not null default 'phone',
  name                  text,
  phone                 text not null,
  project_type          text,                  -- residential | commercial | unknown
  category              text,
  engagement            text,
  scope_kind            text,
  scope_text            text,
  locality              text,
  pin                   text check (pin ~ '^\d{6}$'),
  in_area               text check (in_area in ('in', 'out', 'unclear')),
  sq_ft                 numeric,
  rooms                 integer,
  site_state            text,
  timeline_text         text,
  completion_by         date,
  site_available_from   date,
  decision_maker        text,
  budget_inr            numeric,
  budget_confirmed      boolean not null default false,
  budget_floor_inr      numeric,               -- internal, never shown to callers
  budget_flag           text,                  -- pass | tight | fail | not_given | no_floor
  status                lead_status not null,
  decline_reason        text,
  oos_confidence        numeric check (oos_confidence between 0 and 1),
  in_scope_confidence   numeric check (in_scope_confidence between 0 and 1),
  asked_about_price     boolean not null default false,
  flags                 text[] not null default '{}',
  watch_for             text[] not null default '{}',
  callback_window       text,
  assigned_designer_id  uuid references designers (id),
  hubspot_contact_id    text,
  hubspot_deal_id       text,
  extraction            jsonb not null,        -- full LeadExtraction as stored
  evaluation            jsonb not null,        -- full Evaluation (hard rules, reasons)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index leads_status_idx on leads (status, created_at desc);
create index leads_phone_idx on leads (phone);
create index leads_designer_idx on leads (assigned_designer_id);

create table criteria (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads (id) on delete cascade,
  criterion  text not null check (criterion in ('real_project', 'area', 'timeline', 'budget', 'decision_maker')),
  verdict    criterion_verdict not null,
  evidence   text,
  source     text not null check (source in ('agent', 'server')),
  unique (lead_id, criterion)
);

create table reviews (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references leads (id) on delete cascade,
  reviewer              text not null,          -- display name / telegram username
  reviewer_designer_id  uuid references designers (id),
  decision              review_decision not null,
  source                review_source not null,
  note                  text,
  decided_at            timestamptz not null default now()
);
create unique index reviews_one_decision_per_lead on reviews (lead_id);

create table bookings (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads (id) on delete cascade,
  calcom_uid   text unique,
  event_type   text not null,                 -- residential_consult | commercial_consult | site_visit
  designer     text,
  designer_id  uuid references designers (id),
  slot_start   timestamptz not null,
  slot_end     timestamptz,
  status       text not null default 'booked', -- booked | rescheduled | cancelled
  outcome      text,                           -- held | no_show | won | lost
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index bookings_slot_idx on bookings (slot_start);

create table handoffs (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references leads (id) on delete cascade,
  channel              text not null,          -- telegram_group | telegram_dm | telegram_senior | hubspot
  sent_at              timestamptz,
  delivered            boolean not null default false,
  external_message_id  text,
  action_taken         text,                   -- approved | rejected | opened
  error                text,
  created_at           timestamptz not null default now()
);

create table outbound_attempts (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references leads (id) on delete cascade,
  source_call_id    uuid references calls (id),
  purpose           text not null check (purpose in ('drop_recovery', 'review_approval')),
  attempt_no        integer not null,
  scheduled_for     timestamptz not null,
  provider_call_id  text,
  result            text,                      -- pending | answered | no_answer | failed | booked
  created_at        timestamptz not null default now(),
  unique (lead_id, purpose, attempt_no)
);

-- ---------------------------------------------------------------------------
-- Cost
-- ---------------------------------------------------------------------------
create table rates (
  id              uuid primary key default gen_random_uuid(),
  component       text not null,
  unit            text not null,
  unit_rate_inr   numeric not null check (unit_rate_inr >= 0),
  effective_from  timestamptz not null,
  note            text,
  unique (component, unit, effective_from)
);

create table insights (
  id                uuid primary key default gen_random_uuid(),
  period_start      date not null,
  period_end        date not null,
  metrics_snapshot  jsonb not null,
  narrative         jsonb not null,            -- [{text, metric_key, panel}]
  model             text not null,
  cost_inr          numeric,
  triggered_by      text not null default 'cron', -- cron | refresh
  created_at        timestamptz not null default now()
);

create table call_costs (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid references calls (id) on delete cascade,
  insight_id     uuid references insights (id) on delete cascade,
  component      text not null check (component in
                   ('voice_minutes', 'telephony', 'sms', 'llm_dialogue', 'llm_extraction', 'gemini_insights')),
  unit           text not null,
  units          numeric not null,
  unit_rate_inr  numeric not null,
  cost_inr       numeric not null,
  rate_id        uuid references rates (id),
  raw_usage      jsonb,
  created_at     timestamptz not null default now(),
  constraint cost_has_owner check ((call_id is null) <> (insight_id is null))
);
create index call_costs_created_idx on call_costs (created_at);

-- Rate in effect at a point in time.
create function rate_at(p_component text, p_unit text, p_at timestamptz)
returns rates
language sql stable
as $$
  select * from rates
  where component = p_component and unit = p_unit and effective_from <= p_at
  order by effective_from desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Config & plumbing
-- ---------------------------------------------------------------------------
create table config (
  key                    text primary key,
  value                  jsonb not null,
  description            text,
  needs_founder_signoff  boolean not null default false,
  server_only            boolean not null default false,  -- never exposed to the agent or designers
  updated_at             timestamptz not null default now(),
  updated_by             text references profiles (user_id)
);

-- Idempotency for every webhook: (provider, event_id) is processed once.
create table webhook_events (
  provider     text not null,     -- vaani | calcom | hubspot | telegram | msg91
  event_id     text not null,
  received_at  timestamptz not null default now(),
  status       text not null default 'received',  -- received | processed | failed
  attempts     integer not null default 1,
  last_error   text,
  payload      jsonb,
  primary key (provider, event_id)
);

-- updated_at triggers
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger leads_touch before update on leads for each row execute function touch_updated_at();
create trigger bookings_touch before update on bookings for each row execute function touch_updated_at();
create trigger config_touch before update on config for each row execute function touch_updated_at();
