-- =============================================================================
-- ZERO TRUST — phase52: Analyst Trace −40% pierce Ghost stealth
-- Esegui nell'SQL Editor (dopo phase51).
-- I timer Analyst sono calcolati dal client in start_action (p_end).
-- Qui si aggiorna solo la risoluzione identità Ghost.
-- =============================================================================

create or replace function public.zt_ghost_revealed_name(p_profile public.profiles)
returns text
language plpgsql
stable
as $$
declare
  v_spoof text;
  v_executor_role public.role_type;
begin
  if p_profile.role is distinct from 'ghost' then
    return p_profile.name;
  end if;

  select role into v_executor_role
  from public.profiles
  where id = auth.uid();

  -- Data Analyst: bypass Stealth Protocol e Identity Spoof
  if v_executor_role is not distinct from 'analyst' then
    return p_profile.name;
  end if;

  if p_profile.spoof_until is not null
     and p_profile.spoof_until > timezone('utc', now())
     and p_profile.spoof_as_user_id is not null then
    select name into v_spoof
    from public.profiles
    where id = p_profile.spoof_as_user_id;
    if v_spoof is not null then
      return v_spoof;
    end if;
  end if;

  return 'ENCRYPTED ID';
end;
$$;
