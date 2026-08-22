-- Restore Ghost Identity Spoof in Trace resolution (after phase71 mask).
-- 08:00-playtest hierarchy: Analyst pierce → spoofed username → [ ENCRYPTED ID ].

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

  if p_profile.role is distinct from 'ghost' then
    return p_profile.name;
  end if;

  if v_executor_id is not null then
    select p.role
      into v_executor_role
    from public.profiles p
    where p.id = v_executor_id;
  end if;

  if v_executor_role is not distinct from 'analyst' then
    return p_profile.name;
  end if;

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

  return '[ ENCRYPTED ID ]';
end;
$$;

revoke execute on function public.zt_ghost_revealed_name(public.profiles, uuid)
  from public, anon, authenticated;
