-- =============================================================================
-- ZERO TRUST — phase64: presenza online (last_seen heartbeat)
-- Esegui nell'SQL Editor (dopo phase63).
--
-- Lobby e Directory usano last_seen per distinguere chi è connesso.
-- NULL o più vecchio di 5 minuti = offline. Logout azzera last_seen.
-- =============================================================================

alter table public.profiles
  add column if not exists last_seen timestamptz;

comment on column public.profiles.last_seen is
  'Heartbeat client. NULL = logout / mai connesso. Online se last_seen > now()-5min.';

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen desc);

create or replace function public.heartbeat_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_seen timestamptz;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  update public.profiles
  set last_seen = timezone('utc', now())
  where id = v_actor
  returning last_seen into v_seen;

  return v_seen;
end;
$$;

create or replace function public.clear_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return;
  end if;

  update public.profiles
  set last_seen = null
  where id = v_actor;
end;
$$;

grant execute on function public.heartbeat_presence() to authenticated;
grant execute on function public.clear_presence() to authenticated;

notify pgrst, 'reload schema';
