create table call_messages (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid not null references calls (id) on delete cascade,
  intent           text not null check (intent in ('existing_project_update', 'specific_designer', 'other')),
  caller_name      text,
  phone            text not null,
  for_person       text,
  for_designer_id  uuid references designers (id),
  about            text not null,
  callback_window  text,
  delivered_to     text,          -- telegram_dm | telegram_group | telegram_helpdesk | console
  sent_at          timestamptz,
  done             boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (call_id)
);
create index call_messages_created_idx on call_messages (created_at desc);

alter table call_messages enable row level security;
create policy founder_all on call_messages for all to app_user using (is_founder()) with check (is_founder());
-- Designers see messages addressed to them.
create policy designer_messages on call_messages for select to app_user using (for_designer_id = app_designer_id());
