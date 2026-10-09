-- 2026-10-09: staff are notified by email (Gmail) instead of Telegram; review
-- decisions can now come from an emailed action link.
alter type review_source add value if not exists 'email';
