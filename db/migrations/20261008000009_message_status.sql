-- Non-enquiry calls (update on a project, a named designer, vendor/other) are messages, not leads.
alter type lead_status add value if not exists 'message';
