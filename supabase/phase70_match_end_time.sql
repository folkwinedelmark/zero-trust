-- =============================================================================
-- ZERO TRUST — phase70: match_end_time + chiusura sul timestamp esatto
-- Esegui nell'SQL Editor (dopo phase69).
--
-- Host imposta la data/ora di fine ciclo. Countdown mappa e conclude_match
-- usano match_end_time (fallback: started_at + match_duration_days).
-- =============================================================================

alter table public.game_settings
  add column if not exists match_end_time timestamptz;

comment on column public.game_settings.match_end_time is
  'Fine esatta del ciclo (UTC). Fonte di verità per countdown e auto-conclude.';

update public.game_settings
set match_end_time = started_at + make_interval(days => match_duration_days)
where match_end_time is null
  and game_state = 'ACTIVE'
  and started_at is not null
  and match_duration_days is not null
  and match_duration_days > 0;

create or replace function public.zt_duration_days_until(
  p_from timestamptz,
  p_until timestamptz
)
returns integer
language sql
immutable
as $$
  select greatest(
    1,
    least(
      60,
      ceil(extract(epoch from (p_until - p_from)) / 86400.0)::int
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- start_game: salva match_end_time
-- -----------------------------------------------------------------------------
drop function if exists public.start_game(boolean);
drop function if exists public.start_game(boolean, timestamptz);

create or replace function public.start_game(
  p_allow_solo boolean default false,
  p_end_time timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_state public.game_state_type;
  v_roster jsonb;
  v_now timestamptz := timezone('utc', now());
  v_end timestamptz;
  v_days int;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  select game_state into v_state from public.game_settings where id = 1;
  if v_state = 'ACTIVE' then
    raise exception 'La partita è già attiva';
  end if;

  v_end := coalesce(p_end_time, v_now + interval '7 days');
  if v_end <= v_now then
    raise exception 'La data di fine partita deve essere nel futuro';
  end if;
  v_days := public.zt_duration_days_until(v_now, v_end);

  perform public.zt_reset_cycle_economy();

  v_roster := public.zt_assign_match_factions(p_allow_solo);

  perform public.zt_assign_starting_servers();

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = v_now,
    scheduled_start_time = v_now,
    match_end_time = v_end,
    match_duration_days = v_days,
    winning_faction = null,
    winning_mercenary_id = null,
    match_result = null,
    updated_at = v_now
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'game_start',
      '[SYSTEM] La guerra corporativa è iniziata. Fazioni assegnate e nodi online.',
      'info',
      jsonb_build_object(
        'tone', 'success',
        'match_end_time', v_end,
        'match_duration_days', v_days
      ) || v_roster,
      true
    );
  exception when others then
    raise warning 'start_game log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'match_end_time', v_end,
    'match_duration_days', v_days
  ) || v_roster;
end;
$$;

-- -----------------------------------------------------------------------------
-- schedule_game: start + fine esatta
-- -----------------------------------------------------------------------------
drop function if exists public.schedule_game(timestamptz, integer, boolean);
drop function if exists public.schedule_game(timestamptz, integer, boolean, timestamptz);

create or replace function public.schedule_game(
  p_start_time timestamptz,
  p_duration_days integer default 7,
  p_allow_solo boolean default false,
  p_end_time timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_state public.game_state_type;
  v_roster jsonb;
  v_days int := coalesce(p_duration_days, 7);
  v_end timestamptz;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  if p_start_time is null then
    raise exception 'Orario di inizio non valido';
  end if;

  v_end := coalesce(
    p_end_time,
    p_start_time + make_interval(days => greatest(1, least(60, v_days)))
  );
  if v_end <= p_start_time then
    raise exception 'La data di fine deve essere successiva all''inizio';
  end if;
  v_days := public.zt_duration_days_until(p_start_time, v_end);

  select game_state into v_state from public.game_settings where id = 1;
  if v_state = 'ACTIVE' then
    raise exception 'La partita è già attiva';
  end if;
  if v_state = 'SCHEDULED_WAITING' then
    raise exception 'La partita è già programmata';
  end if;

  if p_start_time <= timezone('utc', now()) then
    return public.start_game(p_allow_solo, v_end);
  end if;

  perform public.zt_reset_cycle_economy();
  v_roster := public.zt_assign_match_factions(p_allow_solo);

  update public.game_settings
  set
    game_state = 'SCHEDULED_WAITING',
    scheduled_start_time = p_start_time,
    match_duration_days = v_days,
    match_end_time = v_end,
    started_at = null,
    winning_faction = null,
    winning_mercenary_id = null,
    match_result = null,
    updated_at = timezone('utc', now())
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'game_scheduled',
      format(
        '[SYSTEM] Guerra programmata per %s. Fine ciclo %s. Fazioni assegnate.',
        to_char(p_start_time at time zone 'utc', 'YYYY-MM-DD HH24:MI UTC'),
        to_char(v_end at time zone 'utc', 'YYYY-MM-DD HH24:MI UTC')
      ),
      'info',
      jsonb_build_object(
        'tone', 'info',
        'scheduled_start_time', p_start_time,
        'match_end_time', v_end,
        'match_duration_days', v_days
      ) || v_roster,
      true
    );
  exception when others then
    raise warning 'schedule_game log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'scheduled', true,
    'scheduled_start_time', p_start_time,
    'match_end_time', v_end,
    'match_duration_days', v_days
  ) || v_roster;
end;
$$;

-- -----------------------------------------------------------------------------
-- conclude_match: scadenza su match_end_time
-- -----------------------------------------------------------------------------
create or replace function public.conclude_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_state public.game_state_type;
  v_started timestamptz;
  v_days int;
  v_end timestamptz;
  v_expired boolean := false;
  v_corp int := 0;
  v_rebel int := 0;
  v_winner public.faction_type;
  v_draw boolean := false;
  v_merc_id uuid;
  v_mercs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select coalesce(is_admin, false) into v_admin
  from public.profiles
  where id = v_actor;

  select game_state, started_at, match_duration_days, match_end_time
  into v_state, v_started, v_days, v_end
  from public.game_settings
  where id = 1;

  if v_state = 'COMPLETED' then
    select match_result into v_result from public.game_settings where id = 1;
    return coalesce(v_result, jsonb_build_object('ok', true, 'already', true));
  end if;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'La partita non è attiva';
  end if;

  v_expired := (
    v_end is not null and timezone('utc', now()) >= v_end
  ) or public.zt_match_has_expired(v_started, v_days);

  if not coalesce(v_admin, false) and not v_expired then
    raise exception 'Solo l''host può chiudere la partita prima della scadenza';
  end if;

  select coalesce(score, 0) into v_corp
  from public.faction_scores
  where faction = 'security';
  v_corp := coalesce(v_corp, 0);

  select coalesce(score, 0) into v_rebel
  from public.faction_scores
  where faction = 'hacktivist';
  v_rebel := coalesce(v_rebel, 0);

  if v_corp > v_rebel then
    v_winner := 'security';
  elsif v_rebel > v_corp then
    v_winner := 'hacktivist';
  else
    v_winner := null;
    v_draw := true;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.rank), '[]'::jsonb)
  into v_mercs
  from (
    select
      p.id,
      p.name,
      coalesce(p.creds, 0) as creds,
      row_number() over (
        order by coalesce(p.creds, 0) desc, p.name asc
      )::int as rank
    from public.profiles p
    where p.faction = 'consultant'
  ) m;

  select m.id
  into v_merc_id
  from (
    select
      p.id,
      row_number() over (
        order by coalesce(p.creds, 0) desc, p.name asc
      ) as rank
    from public.profiles p
    where p.faction = 'consultant'
  ) m
  where m.rank = 1;

  v_result := jsonb_build_object(
    'ok', true,
    'corp_score', v_corp,
    'rebel_score', v_rebel,
    'winning_faction', v_winner,
    'draw', v_draw,
    'winning_mercenary_id', v_merc_id,
    'mercs', v_mercs,
    'concluded_at', timezone('utc', now()),
    'expired', v_expired
  );

  update public.game_settings
  set
    game_state = 'COMPLETED',
    winning_faction = v_winner,
    winning_mercenary_id = v_merc_id,
    match_result = v_result,
    updated_at = timezone('utc', now())
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'match_end',
      '[SYSTEM] Operazione di rete terminata. Ciclo chiuso. Archiviazione dati finali in corso.',
      'info',
      jsonb_build_object(
        'tone', 'warning',
        'tag', 'SYSTEM',
        'corp_score', v_corp,
        'rebel_score', v_rebel,
        'winning_faction', v_winner,
        'draw', v_draw,
        'winning_mercenary_id', v_merc_id,
        'expired', v_expired
      ),
      true
    );
  exception when others then
    raise warning 'conclude_match log failed: %', SQLERRM;
  end;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- reset_lobby: azzera anche match_end_time
-- -----------------------------------------------------------------------------
create or replace function public.reset_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_n int := 0;
  v_logs int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  delete from public.logs where id is not null;
  get diagnostics v_logs = row_count;

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    scheduled_start_time = null,
    match_duration_days = null,
    match_end_time = null,
    winning_faction = null,
    winning_mercenary_id = null,
    match_result = null,
    updated_at = timezone('utc', now())
  where id = 1;

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    briefing_seen = false,
    status = 'idle'
  where id is not null;

  get diagnostics v_n = row_count;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'lobby_reset',
      '[SYSTEM] Server riportato in Lobby. Log del ciclo precedente azzerati.',
      'info',
      jsonb_build_object('tone', 'warning', 'profiles', v_n, 'logs_deleted', v_logs),
      true
    );
  exception when others then
    raise warning 'reset_lobby log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'profiles', v_n, 'logs_deleted', v_logs);
end;
$$;

create or replace function public.zt_clear_match_clock_on_lobby()
returns trigger
language plpgsql
as $$
begin
  if NEW.game_state = 'LOBBY' then
    NEW.match_end_time := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_game_settings_lobby_clock on public.game_settings;
create trigger trg_game_settings_lobby_clock
  before update on public.game_settings
  for each row
  when (NEW.game_state = 'LOBBY')
  execute function public.zt_clear_match_clock_on_lobby();

grant execute on function public.zt_duration_days_until(timestamptz, timestamptz) to authenticated;
grant execute on function public.start_game(boolean, timestamptz) to authenticated;
grant execute on function public.schedule_game(timestamptz, integer, boolean, timestamptz) to authenticated;
grant execute on function public.conclude_match() to authenticated;
grant execute on function public.reset_lobby() to authenticated;

notify pgrst, 'reload schema';
