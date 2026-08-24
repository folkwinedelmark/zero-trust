-- =============================================================================
-- ZERO TRUST — phase69: Reset Totale — wipe completo stats / gigs / intel
-- Esegui nell'SQL Editor (dopo phase68).
--
-- GDD "Users" = public.profiles.
-- Reset Totale deve lasciare ogni operatore in stato vergine: PA, Heat,
-- Reputation, visibilità classe, inventario (Core Data), gigs, note fazione
-- e archivio Analyst.
-- start_game / activate_scheduled_match riusano lo stesso wipe economia
-- così una nuova partita non eredita il ciclo precedente anche senza
-- premere Reset Totale.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Economia / visibilità / archivi di ciclo (non tocca fazione, classe, host)
-- -----------------------------------------------------------------------------
create or replace function public.zt_reset_cycle_economy()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gigs int := 0;
  v_intel int := 0;
  v_dir_notes int := 0;
  v_auctions int := 0;
  v_profiles int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if to_regclass('public.player_notes') is not null then
    delete from public.player_notes where true;
    get diagnostics v_dir_notes = row_count;
  end if;

  if to_regclass('public.intel_reports') is not null then
    delete from public.intel_reports where true;
    get diagnostics v_intel = row_count;
  end if;

  if to_regclass('public.gigs') is not null then
    delete from public.gigs where true;
    get diagnostics v_gigs = row_count;
  end if;

  if to_regclass('public.auctions') is not null then
    delete from public.auctions where true;
    get diagnostics v_auctions = row_count;
  end if;

  update public.profiles
  set
    pa = public.zt_pa_max(),
    heat = 0,
    reputation = 3,
    class_revealed = false,
    creds = 150,
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
    pa_refreshed_at = timezone('utc', now()),
    status = 'idle'
  where true;
  get diagnostics v_profiles = row_count;

  -- core_data è in inventory; se esiste una colonna numerica, azzerala
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'core_data'
  ) then
    execute 'update public.profiles set core_data = 0 where true';
  end if;

  return jsonb_build_object(
    'gigs_deleted', v_gigs,
    'intel_deleted', v_intel,
    'directory_notes_deleted', v_dir_notes,
    'auctions_deleted', v_auctions,
    'profiles', v_profiles
  );
end;
$$;

revoke execute on function public.zt_reset_cycle_economy() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reset Totale (nuova partita da zero)
-- -----------------------------------------------------------------------------
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
  v_economy jsonb;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  if to_regclass('public.notifications') is not null then
    delete from public.notifications where true;
    get diagnostics v_notes = row_count;
  end if;

  delete from public.logs where true;
  get diagnostics v_logs = row_count;

  v_economy := public.zt_reset_cycle_economy();
  v_gigs := coalesce((v_economy->>'gigs_deleted')::int, 0);
  v_intel := coalesce((v_economy->>'intel_deleted')::int, 0);
  v_dir_notes := coalesce((v_economy->>'directory_notes_deleted')::int, 0);
  v_auctions := coalesce((v_economy->>'auctions_deleted')::int, 0);

  v_nodes := public.zt_assign_starting_servers();

  if to_regclass('public.faction_scores') is not null then
    update public.faction_scores
    set score = 0, updated_at = timezone('utc', now())
    where true;
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
  where true;
  get diagnostics v_slots = row_count;

  perform public.zt_ensure_server_backdoors();

  -- Identità lobby + stats (zt_reset_cycle_economy ha già azzerato PA/Heat/…)
  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    briefing_seen = false,
    status = 'idle',
    pa = public.zt_pa_max(),
    heat = 0,
    reputation = 3,
    class_revealed = false,
    creds = 150,
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
    pa_refreshed_at = timezone('utc', now())
  where true;
  get diagnostics v_profiles = row_count;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'core_data'
  ) then
    execute 'update public.profiles set core_data = 0 where true';
  end if;

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    scheduled_start_time = null,
    match_duration_days = null,
    winning_faction = null,
    winning_mercenary_id = null,
    match_result = null,
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

-- -----------------------------------------------------------------------------
-- Nuova partita: stesso wipe economia anche senza Reset Totale
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

  if p_start_time <= timezone('utc', now()) then
    return public.start_game(p_allow_solo);
  end if;

  perform public.zt_reset_cycle_economy();
  v_roster := public.zt_assign_match_factions(p_allow_solo);

  update public.game_settings
  set
    game_state = 'SCHEDULED_WAITING',
    scheduled_start_time = p_start_time,
    match_duration_days = v_days,
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

  perform public.zt_reset_cycle_economy();

  v_roster := public.zt_assign_match_factions(p_allow_solo);

  perform public.zt_assign_starting_servers();

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = timezone('utc', now()),
    scheduled_start_time = timezone('utc', now()),
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

  perform public.zt_reset_cycle_economy();
  perform public.zt_assign_starting_servers();

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = timezone('utc', now()),
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

grant execute on function public.reset_total() to authenticated;
grant execute on function public.schedule_game(timestamptz, integer, boolean) to authenticated;
grant execute on function public.start_game(boolean) to authenticated;
grant execute on function public.activate_scheduled_match(boolean) to authenticated;

notify pgrst, 'reload schema';
