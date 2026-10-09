-- 2026-10-09: the founder's "Today" landing page — a to-do list (founder-written
-- tasks plus AI recommendations they chose to add) and stored AI recommendations.
create table founder_todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  text        text not null check (length(text) between 1 and 300),
  source      text not null default 'founder' check (source in ('founder', 'ai')),
  rec_key     text,                       -- the recommendation it came from (source = 'ai')
  href        text,                       -- where to act on it in the dashboard
  due_on      date,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index founder_todos_user_idx on founder_todos (user_id, done, created_at desc);

-- "Not now" on a recommendation hides it for 7 days.
create table recommendation_dismissals (
  user_id       text not null,
  rec_key       text not null,
  dismissed_at  timestamptz not null default now(),
  primary key (user_id, rec_key)
);

-- Gemini's wording for the day's recommendations (grounded on detected signals).
alter table insights add column recommendations jsonb not null default '[]';

alter table founder_todos enable row level security;
alter table recommendation_dismissals enable row level security;
create policy founder_all on founder_todos for all to app_user using (is_founder()) with check (is_founder());
create policy founder_all on recommendation_dismissals for all to app_user using (is_founder()) with check (is_founder());
