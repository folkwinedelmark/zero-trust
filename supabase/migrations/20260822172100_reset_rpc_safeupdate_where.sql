-- pg_safeupdate blocks DELETE/UPDATE without a WHERE clause.
-- Reset Totale / cycle wipe must use WHERE true so mass clears still run.

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

grant execute on function public.reset_total() to authenticated;

notify pgrst, 'reload schema';
