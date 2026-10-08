-- 1. "Callback needed": not enough info captured → helpdesk calls back.
alter type lead_status add value if not exists 'callback';
