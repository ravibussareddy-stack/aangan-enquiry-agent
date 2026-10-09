-- 2026-10-09: the first live Vaani call (74.7 s, WebRTC, BYOL) was charged ₹5.60,
-- i.e. per-second billing at ≈ ₹4.50/min — not whole minutes at ₹5.
insert into rates (component, unit, unit_rate_inr, effective_from, note)
values ('voice_minutes', 'minute', 4.5, '2026-10-09T00:00:00+05:30',
        'Observed 2026-10-09: a 74.7 s call was charged ₹5.60 → billed per second at ≈ ₹4.50/min (BYOL, WebRTC).')
on conflict (component, unit, effective_from) do nothing;

-- Record that first call at what Vaani actually charged.
update call_costs cc
   set units = 74.71 / 60.0, unit_rate_inr = 4.5, cost_inr = 5.60,
       rate_id = (select id from rates where component = 'voice_minutes' and effective_from = '2026-10-09T00:00:00+05:30')
  from calls c
 where c.id = cc.call_id and c.provider_call_id = 'webrtc-1791530591-6dc09800' and cc.component = 'voice_minutes';
update call_costs cc set units = 74.71 / 60.0
  from calls c
 where c.id = cc.call_id and c.provider_call_id = 'webrtc-1791530591-6dc09800' and cc.component = 'telephony';

update config
   set description = 'Hard cap on total Vaani spend: ₹20. Vaani bills per second (≈ ₹4.50/min observed 2026-10-09: 74.7 s = ₹5.60). No call is answered or placed once logged spend reaches the cap. VOICE_PROVIDER=simulated by default, so no credit is used unless explicitly switched.'
 where key = 'VOICE_SPEND_CAP';
