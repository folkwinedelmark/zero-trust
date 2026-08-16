-- =============================================================================
-- ZERO TRUST — phase58: Scheduled match, briefing, class onboarding
-- Esegui nell'SQL Editor (dopo phase57).
--
-- Spec: LOBBY = PENDING_LOBBY. Nuovo stato SCHEDULED_WAITING.
-- game_settings: scheduled_start_time, match_duration_days
-- profiles: briefing_seen (role resta la "class" del giocatore)
-- RPCs: schedule_game, activate_scheduled_match, mark_briefing_seen
-- =============================================================================

alter type public.game_state_type add value if not exists 'SCHEDULED_WAITING';

alter table public.game_settings
  add column if not exists scheduled_start_time timestamptz;

alter table public.game_settings
  add column if not exists match_duration_days integer;

comment on column public.game_settings.scheduled_start_time is
  'Countdown lobby: la partita diventa ACTIVE a questo istante.';
comment on column public.game_settings.match_duration_days is
  'Durata prevista del ciclo di guerra, in giorni.';

alter table public.profiles
  add column if not exists briefing_seen boolean not null default false;

comment on column public.profiles.briefing_seen is
  'True dopo il briefing fazione del primo ingresso in partita ACTIVE.';

-- Partite già in corso: non riaprire il briefing a chi ha già una classe
update public.profiles
set briefing_seen = true
where role is not null
  and briefing_seen is distinct from true;

-- -----------------------------------------------------------------------------
-- Assegnazione fazioni (stesso algoritmo di start_game)
-- -----------------------------------------------------------------------------
create or replace function public.zt_assign_match_factions(p_allow_solo boolean default false)
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
  select coalesce(array_agg(id order by random()), '{}')
  into v_ids
  from public.profiles;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 1 then
    raise exception 'Nessun giocatore in lobby';
  end if;
  if v_n < 2 and not coalesce(p_allow_solo, false) then
    raise exception 'Servono almeno 2 giocatori';
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

revoke execute on function public.zt_assign_match_factions(boolean) from public, anon, authenticated;

-- Late joiner durante SCHEDULED_WAITING: fazione sul team più piccolo
create or replace function public.zt_assign_late_joiner_faction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.game_state_type;
  v_corp int := 0;
  v_rebel int := 0;
  v_merc int := 0;
begin
  if NEW.faction is not null then
    return NEW;
  end if;

  select game_state into v_state from public.game_settings where id = 1;
  if v_state is distinct from 'SCHEDULED_WAITING' then
    return NEW;
  end if;

  select
    count(*) filter (where faction = 'security'),
    count(*) filter (where faction = 'hacktivist'),
    count(*) filter (where faction = 'consultant')
  into v_corp, v_rebel, v_merc
  from public.profiles
  where id is distinct from NEW.id;

  if v_corp <= v_rebel and v_corp <= v_merc then
    NEW.faction := 'security';
  elsif v_rebel <= v_merc then
    NEW.faction := 'hacktivist';
  else
    NEW.faction := 'consultant';
  end if;

  NEW.role := null;
  NEW.briefing_seen := false;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_late_joiner_faction on public.profiles;
create trigger trg_profiles_late_joiner_faction
  before insert on public.profiles
  for each row
  execute function public.zt_assign_late_joiner_faction();

-- -----------------------------------------------------------------------------
-- Programma la partita (fazioni ora, rete al countdown)
-- -----------------------------------------------------------------------------
create or replace function public.schedule_game(
  p_start_time timestamptz,
  p_duration_days integer default 7,
  p_allow_solo boolean default false
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
  if v_days < 1 or v_days > 60 then
    raise exception 'Durata non valida (1–60 giorni)';
  end if;

  select game_state into v_state from public.game_settings where id = 1;
  if v_state = 'ACTIVE' then
    raise exception 'La partita è già attiva';
  end if;
  if v_state = 'SCHEDULED_WAITING' then
    raise exception 'La partita è già programmata';
  end if;

  -- Se l'orario è già scaduto, avvia subito
  if p_start_time <= timezone('utc', now()) then
    return public.start_game(p_allow_solo);
  end if;

  v_roster := public.zt_assign_match_factions(p_allow_solo);

  update public.game_settings
  set
    game_state = 'SCHEDULED_WAITING',
    scheduled_start_time = p_start_time,
    match_duration_days = v_days,
    started_at = null,
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
        '[SYSTEM] Guerra programmata per %s. Fazioni assegnate. Accesso alla rete bloccato fino al via.',
        to_char(p_start_time at time zone 'utc', 'YYYY-MM-DD HH24:MI UTC')
      ),
      'info',
      jsonb_build_object(
        'tone', 'info',
        'scheduled_start_time', p_start_time,
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
    'match_duration_days', v_days
  ) || v_roster;
end;
$$;

-- -----------------------------------------------------------------------------
-- Transizione SCHEDULED_WAITING → ACTIVE (qualsiasi player se l'ora è scaduta)
-- -----------------------------------------------------------------------------
create or replace function public.activate_scheduled_match(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_state public.game_state_type;
  v_start timestamptz;
  v_days int;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select game_state, scheduled_start_time, match_duration_days
  into v_state, v_start, v_days
  from public.game_settings
  where id = 1;

  if v_state = 'ACTIVE' then
    return jsonb_build_object('ok', true, 'already_active', true);
  end if;

  if v_state is distinct from 'SCHEDULED_WAITING' then
    raise exception 'Nessuna partita in attesa di avvio';
  end if;

  select coalesce(is_admin, false) into v_admin
  from public.profiles
  where id = v_actor;

  if coalesce(p_force, false) then
    if not v_admin then
      raise exception 'Solo l''host può forzare l''avvio';
    end if;
  elsif v_start is null or v_start > timezone('utc', now()) then
    raise exception 'Il countdown non è ancora scaduto';
  end if;

  perform public.zt_assign_starting_servers();

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'game_start',
      '[SYSTEM] La guerra corporativa è iniziata. Nodi online. Briefing fazione in corso.',
      'info',
      jsonb_build_object(
        'tone', 'success',
        'forced', coalesce(p_force, false),
        'match_duration_days', v_days
      ),
      true
    );
  exception when others then
    raise warning 'activate_scheduled_match log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'activated', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Briefing visto: sblocca la selezione classe
-- -----------------------------------------------------------------------------
create or replace function public.mark_briefing_seen()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_state public.game_state_type;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select game_state into v_state from public.game_settings where id = 1;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'La partita non è ancora iniziata';
  end if;

  update public.profiles
  set briefing_seen = true
  where id = v_actor;

  return jsonb_build_object('ok', true, 'briefing_seen', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- start_game: reset briefing_seen insieme a fazione/classe
-- -----------------------------------------------------------------------------
create or replace function public.start_game(p_allow_solo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_state public.game_state_type;
  v_roster jsonb;
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

  v_roster := public.zt_assign_match_factions(p_allow_solo);

  perform public.zt_assign_starting_servers();

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = timezone('utc', now()),
    scheduled_start_time = timezone('utc', now()),
    updated_at = timezone('utc', now())
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
      jsonb_build_object('tone', 'success') || v_roster,
      true
    );
  exception when others then
    raise warning 'start_game log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true) || v_roster;
end;
$$;

create or replace function public.reset_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_n int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    scheduled_start_time = null,
    match_duration_days = null,
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
      '[SYSTEM] Server riportato in Lobby. Fazioni, classi e briefing azzerati.',
      'info',
      jsonb_build_object('tone', 'warning', 'profiles', v_n),
      true
    );
  exception when others then
    raise warning 'reset_lobby log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'profiles', v_n);
end;
$$;

create or replace function public.reset_total()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_logs int := 0;
  v_gigs int := 0;
  v_auctions int := 0;
  v_nodes int := 0;
  v_slots int := 0;
  v_profiles int := 0;
  v_notes int := 0;
  v_intel int := 0;
  v_dir_notes int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  if to_regclass('public.notifications') is not null then
    delete from public.notifications where id is not null;
    get diagnostics v_notes = row_count;
  end if;

  if to_regclass('public.player_notes') is not null then
    delete from public.player_notes where id is not null;
    get diagnostics v_dir_notes = row_count;
  end if;

  delete from public.logs where id is not null;
  get diagnostics v_logs = row_count;

  if to_regclass('public.intel_reports') is not null then
    delete from public.intel_reports where id is not null;
    get diagnostics v_intel = row_count;
  end if;

  if to_regclass('public.gigs') is not null then
    delete from public.gigs where id is not null;
    get diagnostics v_gigs = row_count;
  end if;

  if to_regclass('public.auctions') is not null then
    delete from public.auctions where id is not null;
    get diagnostics v_auctions = row_count;
  end if;

  v_nodes := public.zt_assign_starting_servers();

  if to_regclass('public.faction_scores') is not null then
    update public.faction_scores
    set score = 0, updated_at = timezone('utc', now())
    where faction is not null;
  end if;

  update public.slots
  set
    user_id = null,
    action_type = null,
    start_time = null,
    end_time = null,
    is_decoy = false,
    is_spoofed = false,
    spoofed_as_user_id = null,
    spoofed_action = null,
    target_slot_id = null,
    locked_until = null,
    backdoor_until = null,
    backdoor_owner_id = null,
    is_immune = false
  where id is not null;
  get diagnostics v_slots = row_count;

  perform public.zt_ensure_server_backdoors();

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    briefing_seen = false,
    status = 'idle',
    creds = 150,
    reputation = 3,
    pa = public.zt_pa_max(),
    heat = 0,
    pa_refreshed_at = timezone('utc', now()),
    inventory = '[]'::jsonb,
    owned_hardware = '{}',
    equipped_hardware = '{}'::text[],
    is_blocked = false,
    frozen_until = null,
    nda_until = null,
    kick_immune_until = null,
    has_legal_shield = false,
    spoof_until = null,
    spoof_as_user_id = null,
    stealth_until = null,
    equipment_cooldown_until = null,
    travel_until = null,
    travel_intent = null,
    ability_cooldowns = '{}'::jsonb,
    cooldowns = '{}'::jsonb,
    buffs = '{}',
    current_node_id = null,
    class_revealed = false
  where id is not null;
  get diagnostics v_profiles = row_count;

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    scheduled_start_time = null,
    match_duration_days = null,
    updated_at = timezone('utc', now())
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'logs_deleted', v_logs,
    'intel_deleted', v_intel,
    'gigs_deleted', v_gigs,
    'auctions_deleted', v_auctions,
    'servers_reset', v_nodes,
    'slots_cleared', v_slots,
    'profiles', v_profiles,
    'notifications_deleted', v_notes,
    'directory_notes_deleted', v_dir_notes
  );
end;
$$;

grant execute on function public.schedule_game(timestamptz, integer, boolean) to authenticated;
grant execute on function public.activate_scheduled_match(boolean) to authenticated;
grant execute on function public.mark_briefing_seen() to authenticated;
grant execute on function public.start_game(boolean) to authenticated;
grant execute on function public.reset_lobby() to authenticated;
grant execute on function public.reset_total() to authenticated;

notify pgrst, 'reload schema';
