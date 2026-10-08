-- Postgres 16+: the role that created app_user holds ADMIN on it but not SET,
-- so the server couldn't `set local role app_user`. Grant membership to the
-- migration (owner) role so dashboard requests can drop into app_user.
grant app_user to current_user;
