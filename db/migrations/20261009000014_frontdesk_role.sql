-- 2026-10-09: a front desk / helpdesk role and its dashboard view.
-- Front desk works the callback queue, complaints, messages and today's
-- consultations: it can read calls, leads and bookings, and mark messages
-- done — but never config, rates, costs, insights or webhook logs.
-- (Role comparisons use ::text: a new enum value can't be used in the
-- transaction that adds it.)
alter type app_role add value if not exists 'frontdesk';

create function is_frontdesk() returns boolean
language sql stable
as $$ select coalesce(app_role()::text = 'frontdesk', false) $$;

create policy frontdesk_leads     on leads         for select to app_user using (is_frontdesk());
create policy frontdesk_calls     on calls         for select to app_user using (is_frontdesk());
create policy frontdesk_criteria  on criteria      for select to app_user using (is_frontdesk());
create policy frontdesk_bookings  on bookings      for select to app_user using (is_frontdesk());
create policy frontdesk_handoffs  on handoffs      for select to app_user using (is_frontdesk());
create policy frontdesk_reviews   on reviews       for select to app_user using (is_frontdesk());
create policy frontdesk_messages  on call_messages for select to app_user using (is_frontdesk());
create policy frontdesk_messages_done on call_messages for update to app_user using (is_frontdesk()) with check (is_frontdesk());

-- Designers can tick off messages addressed to them.
create policy designer_messages_done on call_messages for update to app_user
  using (for_designer_id = app_designer_id()) with check (for_designer_id = app_designer_id());
