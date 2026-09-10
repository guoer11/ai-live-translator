-- Backend-only allowlist. Populate actual family addresses in the dashboard,
-- never commit personal email addresses to the public repository.
create table if not exists public.translator_allowed_users (
  email text primary key check (email = lower(email)),
  enabled boolean not null default true
);
alter table public.translator_allowed_users enable row level security;
revoke all on public.translator_allowed_users from public, anon, authenticated;
grant select on public.translator_allowed_users to service_role;
