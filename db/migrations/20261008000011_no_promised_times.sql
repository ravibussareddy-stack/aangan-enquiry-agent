-- 2026-10-08: never promise a call-back time. Update the complaint SMS template
-- (the seed upsert never overwrites existing config values).
update config
   set value = jsonb_set(value, '{complaint_ack,text}', to_jsonb('Aangan Studio: we''re sorry about this. A senior member of our team will call you back as soon as possible.'::text))
 where key = 'SMS_TEMPLATES';
update config
   set description = 'No longer promised to callers (2026-10-08: never guarantee a time — say ''as soon as possible'' and ask when they''re free). Used only as the internal target for seniors.'
 where key = 'COMPLAINT_CALLBACK_MINUTES';
