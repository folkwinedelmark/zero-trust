-- Only PRONTO (is_ready) players are assigned factions at match start.
--
-- zt_assign_match_factions include SOLO profiles.is_ready = true.
-- Chi non ha cliccato PRONTO resta senza fazione (faction null).
-- =============================================================================

create or replace function public.zt_assign_match_factions(
  p_allow_solo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_n int := 0;
  v_merc int := 0;
  v_corp int := 0;
  v_rebel int := 0;
  v_i int := 1;
  v_id uuid;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  -- Fuori dal ciclo: niente fazione/classe per chi non è PRONTO
  update public.profiles
  set
    faction = null,
    role = null,
    briefing_seen = false
  where coalesce(is_ready, false) is distinct from true;

  select coalesce(array_agg(id order by random()), '{}')
  into v_ids
  from public.profiles
  where coalesce(is_ready, false);

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 1 then
    raise exception 'Nessun giocatore pronto in lobby';
  end if;
  if v_n < 2 and not coalesce(p_allow_solo, false) then
    raise exception 'Servono almeno 2 giocatori pronti';
  end if;

  if v_n = 1 then
    v_corp := 1;
    v_rebel := 0;
    v_merc := 0;
  elsif v_n <= 4 then
    v_merc := v_n % 2;
    v_corp := (v_n - v_merc + 1) / 2;
    v_rebel := v_n - v_merc - v_corp;
  else
    v_merc := greatest(1, round(v_n * 0.25)::int);
    v_corp := (v_n - v_merc + 1) / 2;
    v_rebel := v_n - v_merc - v_corp;
  end if;

  while v_i <= v_n loop
    v_id := v_ids[v_i];
    if v_i <= v_corp then
      update public.profiles
      set
        faction = 'security',
        is_ready = false,
        role = null,
        briefing_seen = false
      where id = v_id;
    elsif v_i <= v_corp + v_rebel then
      update public.profiles
      set
        faction = 'hacktivist',
        is_ready = false,
        role = null,
        briefing_seen = false
      where id = v_id;
    else
      update public.profiles
      set
        faction = 'consultant',
        is_ready = false,
        role = null,
        briefing_seen = false
      where id = v_id;
    end if;
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object(
    'players', v_n,
    'corp', v_corp,
    'rebel', v_rebel,
    'merc', v_merc
  );
end;
$$;

revoke execute on function public.zt_assign_match_factions(boolean)
  from public, anon, authenticated;

-- Nuovi profili durante il countdown: niente fazione senza PRONTO
create or replace function public.zt_assign_late_joiner_faction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo chi era PRONTO a schedule/start entra nel ciclo.
  return NEW;
end;
$$;

notify pgrst, 'reload schema';
