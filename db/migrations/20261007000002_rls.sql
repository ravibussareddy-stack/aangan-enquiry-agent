-- Row-level security — defence in depth behind the server's own checks.
--   founder  — everything
--   designer — the review queue and their own leads (plus related rows)
--
-- Webhooks and cron connect as the database owner (bypasses RLS). Dashboard
-- requests run inside a transaction that does:
--   set local role app_user;
--   select set_config('app.user_id', <Neon Auth user id>, true);
-- (see lib/db/as-user.ts).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;

create function app_user_id() returns text
language sql stable
as $$ select nullif(current_setting('app.user_id', true), '') $$;

create function app_role() returns app_role
language sql stable security definer set search_path = public
as $$ select role from profiles where user_id = app_user_id() $$;

create function app_designer_id() returns uuid
language sql stable security definer set search_path = public
as $$ select designer_id from profiles where user_id = app_user_id() $$;

create function is_founder() returns boolean
language sql stable
as $$ select coalesce(app_role() = 'founder', false) $$;

-- A lead a designer may see: in the review queue, or assigned to them.
create function designer_can_see_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id
      and app_role() = 'designer'
      and (l.status = 'review' or l.assigned_designer_id = app_designer_id())
  )
$$;

alter table designers         enable row level security;
alter table profiles          enable row level security;
alter table calls             enable row level security;
alter table leads             enable row level security;
alter table criteria          enable row level security;
alter table reviews           enable row level security;
alter table bookings          enable row level security;
alter table handoffs          enable row level security;
alter table outbound_attempts enable row level security;
alter table rates             enable row level security;
alter table insights          enable row level security;
alter table call_costs        enable row level security;
alter table config            enable row level security;
alter table webhook_events    enable row level security;

-- Founder: full access to everything.
do $$
declare t text;
begin
  foreach t in array array[
    'designers', 'profiles', 'calls', 'leads', 'criteria', 'reviews', 'bookings', 'handoffs',
    'outbound_attempts', 'rates', 'insights', 'call_costs', 'config', 'webhook_events'
  ] loop
    execute format(
      'create policy founder_all on %I for all to app_user using (is_founder()) with check (is_founder())', t);
  end loop;
end $$;

-- Everyone signed in can read their own profile and the designer directory.
create policy own_profile on profiles for select to app_user using (user_id = app_user_id());
create policy designers_read on designers for select to app_user using (app_role() is not null);

-- Designers: review queue + own leads, and the rows hanging off them.
create policy designer_leads on leads for select to app_user
  using (designer_can_see_lead(id));
create policy designer_criteria on criteria for select to app_user
  using (designer_can_see_lead(lead_id));
create policy designer_bookings on bookings for select to app_user
  using (designer_can_see_lead(lead_id));
create policy designer_handoffs on handoffs for select to app_user
  using (designer_can_see_lead(lead_id));
create policy designer_reviews_read on reviews for select to app_user
  using (designer_can_see_lead(lead_id));
create policy designer_calls on calls for select to app_user
  using (exists (select 1 from leads l where l.call_id = calls.id and designer_can_see_lead(l.id)));

-- Designers may record a decision on a lead that is in review, as themselves, from the dashboard.
create policy designer_reviews_insert on reviews for insert to app_user
  with check (
    source = 'dashboard'
    and reviewer_designer_id = app_designer_id()
    and exists (select 1 from leads l where l.id = lead_id and l.status = 'review' and designer_can_see_lead(l.id))
  );

-- Designers never see config, rates, costs, insights or webhook logs (no policy = no access).
