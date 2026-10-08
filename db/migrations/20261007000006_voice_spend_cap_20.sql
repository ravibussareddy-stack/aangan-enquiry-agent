-- The user's limit for this case study is ₹20 of Vaani credit in total.
-- The seed upsert intentionally never overwrites config values (so founder edits
-- survive), so the lowered cap in db/seed/config.json never reached the database.
update config
   set value = '{"cap_inr": 20, "reserve_inr": 0, "max_call_s": 240, "outbound_attempts": 1}'::jsonb,
       description = 'Hard cap on total Vaani spend: ₹20 (≈4 billed minutes at ₹5/min; Vaani appears to round each call up to whole minutes). No call is answered or placed once logged spend reaches the cap. VOICE_PROVIDER=simulated by default, so no credit is used unless explicitly switched.'
 where key = 'VOICE_SPEND_CAP';
