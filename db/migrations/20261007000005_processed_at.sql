-- When the post-call pipeline received the finished call. Handoff latency
-- (target ≤ 2 min) is measured from here, which also works for simulated calls
-- whose started/ended times come from a simulated clock.
alter table calls add column processed_at timestamptz;
