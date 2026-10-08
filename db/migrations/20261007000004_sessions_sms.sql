-- Per-call dialogue state written by the voice brain (BYOL server or the
-- simulator) and read by the post-call pipeline — they run in different processes.
create table call_sessions (
  provider_call_id  text primary key,
  provider          text not null default 'vaani',
  state             jsonb not null,
  updated_at        timestamptz not null default now()
);

-- Every customer SMS, sent or (in console mode) only logged.
create table sms_messages (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references leads (id) on delete set null,
  to_phone         text not null,
  template         text not null,
  body             text not null,
  provider         text not null,          -- console | msg91
  status           text not null,          -- logged | sent | delivered | failed
  provider_msg_id  text,
  error            text,
  created_at       timestamptz not null default now()
);
create index sms_messages_created_idx on sms_messages (created_at desc);

-- Demo/simulated rows are tagged so the dashboard can filter or clear them.
alter table calls add column is_simulated boolean not null default false;

alter table call_sessions enable row level security;
alter table sms_messages enable row level security;
create policy founder_all on call_sessions for all to app_user using (is_founder()) with check (is_founder());
create policy founder_all on sms_messages for all to app_user using (is_founder()) with check (is_founder());
