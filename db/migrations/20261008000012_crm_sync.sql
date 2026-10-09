-- 2026-10-08: HubSpot service keys can't send webhooks, so the app pulls deal
-- stages instead. hubspot_stage = the stage the app last wrote or saw, so a
-- pull only acts on changes someone made in HubSpot (no echo of our own writes).
alter table leads add column hubspot_stage text;

create table crm_sync_state (
  provider      text primary key,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  last_checked  integer not null default 0,
  last_changes  integer not null default 0
);
insert into crm_sync_state (provider) values ('hubspot');

alter table crm_sync_state enable row level security;
create policy founder_all on crm_sync_state for all to app_user using (is_founder()) with check (is_founder());
