-- =============================================================================
-- ZERO TRUST — phase46: starting server ownership (no Neutral)
-- Esegui nell'SQL Editor (dopo phase45).
--
-- Aegis Prime  → CORP (security)
-- Helix Core   → REBEL (hacktivist)
-- Omni Grid    → MERCENARY (consultant)
-- ICE = 100 su tutti. Fallback server sconosciuti → consultant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed ownership: 1 server per fazione, ICE 100
-- -----------------------------------------------------------------------------
create or replace function public.zt_assign_starting_servers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  update public.nodes
  set
    ice = 100,
    owner_faction = case
      when lower(btrim(name)) in ('aegis prime', 'aegis-prime') then 'security'::public.faction_type
      when lower(btrim(name)) in ('helix core', 'helix-core') then 'hacktivist'::public.faction_type
      when lower(btrim(name)) in ('omni grid', 'omni-grid') then 'consultant'::public.faction_type
      else 'consultant'::public.faction_type
    end,
    compromised = false,
    ddos_until = null
  where type = 'server';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reset Totale: distribuisce i 3 server invece di azzerarli a Neutral
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
    status = 'idle',
    creds = 150,
    reputation = 3,
    pa = public.zt_pa_max(),
    heat = 0,
    pa_refreshed_at = timezone('utc', now()),
    inventory = '[]'::jsonb,
    owned_hardware = '{}',
    equipped_hardware = null,
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
    current_node_id = null
  where id is not null;
  get diagnostics v_profiles = row_count;

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
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
    'notifications_deleted', v_notes
  );
end;
$$;

grant execute on function public.reset_total() to authenticated;

-- -----------------------------------------------------------------------------
-- start_game: stessa distribuzione all'avvio partita
-- -----------------------------------------------------------------------------
create or replace function public.start_game(p_allow_solo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ids uuid[];
  v_n int := 0;
  v_merc int := 0;
  v_corp int := 0;
  v_rebel int := 0;
  v_i int := 1;
  v_id uuid;
  v_state public.game_state_type;
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
      set faction = 'security', is_ready = false, role = null
      where id = v_id;
    elsif v_i <= v_corp + v_rebel then
      update public.profiles
      set faction = 'hacktivist', is_ready = false, role = null
      where id = v_id;
    else
      update public.profiles
      set faction = 'consultant', is_ready = false, role = null
      where id = v_id;
    end if;
    v_i := v_i + 1;
  end loop;

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
      '[SYSTEM] La guerra corporativa è iniziata. Fazioni assegnate e nodi online.',
      'info',
      jsonb_build_object(
        'tone', 'success',
        'corp', v_corp,
        'rebel', v_rebel,
        'merc', v_merc,
        'players', v_n
      ),
      true
    );
  exception when others then
    raise warning 'start_game log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'players', v_n,
    'corp', v_corp,
    'rebel', v_rebel,
    'merc', v_merc
  );
end;
$$;

grant execute on function public.start_game(boolean) to authenticated;

notify pgrst, 'reload schema';
