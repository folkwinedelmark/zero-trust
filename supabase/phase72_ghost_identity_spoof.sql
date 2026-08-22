-- =============================================================================
-- ZERO TRUST — phase72: restore Ghost Identity Spoof on Trace
-- Esegui nell'SQL Editor (dopo phase71).
--
-- Gerarchia nome rivelato (bersaglio Ghost):
--   1. Esecutore Analyst     → username REALE del bersaglio (pierce totale)
--   2. Spoof attivo          → username di spoof_as_user_id (mai auth.uid / executor)
--   3. Default               → '[ ENCRYPTED ID ]'
-- =============================================================================

create or replace function public.zt_ghost_revealed_name(
  p_profile public.profiles,
  p_executor_id uuid default null
)
returns text
language plpgsql
stable
as $$
declare
  v_executor_id uuid;
  v_executor_role public.role_type;
  v_spoof_id uuid;
  v_spoof_name text;
begin
  v_executor_id := coalesce(p_executor_id, auth.uid());

  -- Non-Ghost: identità in chiaro
  if p_profile.role is distinct from 'ghost' then
    return p_profile.name;
  end if;

  if v_executor_id is not null then
    select p.role
      into v_executor_role
    from public.profiles p
    where p.id = v_executor_id;
  end if;

  -- 1. Data Analyst: pierce stealth e spoof
  if v_executor_role is not distinct from 'analyst' then
    return p_profile.name;
  end if;

  -- 2. Identity Spoof attivo: SOLO il profilo puntato da spoof_as_user_id
  v_spoof_id := p_profile.spoof_as_user_id;
  if v_spoof_id is not null
     and p_profile.spoof_until is not null
     and p_profile.spoof_until > timezone('utc', now()) then
    select p.name
      into v_spoof_name
    from public.profiles p
    where p.id = v_spoof_id;

    if v_spoof_name is not null and btrim(v_spoof_name) <> '' then
      return v_spoof_name;
    end if;
  end if;

  -- 3. Stealth Protocol
  return '[ ENCRYPTED ID ]';
end;
$$;

revoke execute on function public.zt_ghost_revealed_name(public.profiles, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
