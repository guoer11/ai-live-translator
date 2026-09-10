-- Run once in the chosen Supabase project's SQL Editor, or package via
-- `supabase migration new translator_quota` when CLI migration tracking is used.
-- No audio, transcripts, user records, or access codes are stored here.
begin;
create table if not exists public.translator_session_quota (
  id boolean primary key default true check (id),
  minute_start timestamptz not null default date_trunc('minute', now()),
  minute_count integer not null default 0,
  day_start timestamptz not null default (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
  day_count integer not null default 0
);
alter table public.translator_session_quota enable row level security;
revoke all on public.translator_session_quota from public, anon, authenticated;
grant select, insert, update on public.translator_session_quota to service_role;
insert into public.translator_session_quota(id) values(true) on conflict do nothing;

-- SECURITY INVOKER intentionally retains caller permissions. Only service_role
-- can call this RPC or read/update the quota row; no public RLS policy is added.
create or replace function public.translator_take_session()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  q public.translator_session_quota%rowtype;
  minute_now timestamptz := date_trunc('minute', now());
  day_now timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  select * into q from public.translator_session_quota where id = true for update;
  if not found then return false; end if;
  if q.minute_start <> minute_now then q.minute_start := minute_now; q.minute_count := 0; end if;
  if q.day_start <> day_now then q.day_start := day_now; q.day_count := 0; end if;
  -- Entire application: 5 new sessions/minute and 50/day (UTC).
  if q.minute_count >= 5 or q.day_count >= 50 then return false; end if;
  update public.translator_session_quota
    set minute_start=q.minute_start, minute_count=q.minute_count+1,
        day_start=q.day_start, day_count=q.day_count+1 where id=true;
  return true;
end;
$$;
revoke all on function public.translator_take_session() from public, anon, authenticated;
grant execute on function public.translator_take_session() to service_role;
commit;
