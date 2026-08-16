-- =============================================================================
-- ZERO TRUST — phase44: Intel Archive wipe on Reset Totale + debug clear
-- Esegui nell'SQL Editor (dopo phase43).
--
-- 1. reset_total() ora svuota anche public.intel_reports (ghost data tra partite).
-- 2. zt_clear_intel_archive() svuota SOLO l'archivio dell'utente corrente (God Mode).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Debug: svuota l'archivio intel del chiamante
-- -----------------------------------------------------------------------------
create or replace function public.zt_clear_intel_archive()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  if to_regclass('public.intel_reports') is null then
    return jsonb_build_object('ok', true, 'deleted', 0);
  end if;

  delete from public.intel_reports
  where analyst_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

grant execute on function public.zt_clear_intel_archive() to authenticated;

-- -----------------------------------------------------------------------------
-- Reset Totale: include wipe intel_reports
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

  update public.nodes
  set
    ice = 100,
    owner_faction = null,
    compromised = false,
    ddos_until = null
  where type = 'server';
  get diagnostics v_nodes = row_count;

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

notify pgrst, 'reload schema';
