-- =============================================================================
-- ZERO TRUST — phase47: Executive dual hardware (equipped_hardware text[])
-- Esegui nell'SQL Editor (dopo phase46).
--
-- equipped_hardware: text → text[] (default {}).
-- Executive: 2 slot. Altre classi: 1 slot.
-- Unequip senza cooldown. Equip mantiene il cooldown 30s.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema: text → text[]
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'equipped_hardware'
      and udt_name = 'text'
  ) then
    alter table public.profiles alter column equipped_hardware drop default;
    alter table public.profiles
      alter column equipped_hardware type text[]
      using case
        when equipped_hardware is null or btrim(equipped_hardware) = '' then '{}'::text[]
        else array[equipped_hardware]
      end;
  end if;
end $$;

alter table public.profiles
  alter column equipped_hardware set default '{}'::text[];

update public.profiles
set equipped_hardware = '{}'::text[]
where equipped_hardware is null;

comment on column public.profiles.equipped_hardware is
  'Hardware attivi. Executive fino a 2 ID; le altre classi 1.';

create or replace function public.zt_hw_cap(p_role public.role_type)
returns int
language sql
immutable
as $$
  select case when p_role = 'executive' then 2 else 1 end;
$$;

-- -----------------------------------------------------------------------------
-- Equip: aggiunge all'array se c'è capienza (cooldown 30s)
-- -----------------------------------------------------------------------------
create or replace function public.afterlife_equip(p_hardware_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owned text[];
  v_equipped text[];
  v_cd timestamptz;
  v_role public.role_type;
  v_max int;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select owned_hardware, coalesce(equipped_hardware, '{}'::text[]), equipment_cooldown_until, role
  into v_owned, v_equipped, v_cd, v_role
  from public.profiles
  where id = v_actor
  for update;

  if v_owned is null or not (v_owned @> array[p_hardware_id]::text[]) then
    raise exception 'Non possiedi questo hardware';
  end if;

  if v_equipped @> array[p_hardware_id]::text[] then
    return jsonb_build_object(
      'ok', true,
      'equipped', to_jsonb(v_equipped),
      'unchanged', true
    );
  end if;

  v_max := public.zt_hw_cap(v_role);
  if coalesce(array_length(v_equipped, 1), 0) >= v_max then
    raise exception 'Limite hardware raggiunto. Disinstalla un componente attivo.';
  end if;

  if v_cd is not null and v_cd > timezone('utc', now()) then
    raise exception 'Equip in cooldown (% s)',
      greatest(1, ceil(extract(epoch from (v_cd - timezone('utc', now())))))::int;
  end if;

  v_equipped := array_append(v_equipped, p_hardware_id);

  update public.profiles
  set
    equipped_hardware = v_equipped,
    equipment_cooldown_until = timezone('utc', now()) + interval '30 seconds'
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'equipped', to_jsonb(v_equipped),
    'cooldown_seconds', 30
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Unequip: rimuove dall'array, nessun cooldown
-- -----------------------------------------------------------------------------
create or replace function public.afterlife_unequip(p_hardware_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_equipped text[];
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select coalesce(equipped_hardware, '{}'::text[])
  into v_equipped
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;

  v_equipped := array_remove(v_equipped, p_hardware_id);

  update public.profiles
  set equipped_hardware = v_equipped
  where id = v_actor;

  return jsonb_build_object('ok', true, 'equipped', to_jsonb(v_equipped));
end;
$$;

grant execute on function public.afterlife_equip(text) to authenticated;
grant execute on function public.afterlife_unequip(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Buy: auto-equip se c'è uno slot libero
-- -----------------------------------------------------------------------------
create or replace function public.afterlife_buy(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rep int;
  v_creds int;
  v_inv jsonb;
  v_owned text[];
  v_equipped text[];
  v_role public.role_type;
  v_base int;
  v_price int;
  v_kind text;
  v_entry jsonb;
  v_auto_equip boolean := false;
  v_max int;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_daytime();

  v_base := public.zt_item_base_price(p_item_id);
  if v_base is null then
    raise exception 'Item sconosciuto';
  end if;

  if p_item_id in ('ram', 'gps', 'crypto_nic', 'heuristic') then
    v_kind := 'hardware';
  elsif p_item_id in ('ddos', 'bailout', 'intel', 'jammer', 'lockout', 'wiper') then
    v_kind := 'software';
  else
    raise exception 'Usa afterlife_helpdesk per i servizi IT';
  end if;

  select reputation, creds, inventory, owned_hardware, coalesce(equipped_hardware, '{}'::text[]), role
  into v_rep, v_creds, v_inv, v_owned, v_equipped, v_role
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if v_kind = 'hardware' then
    if v_owned @> array[p_item_id]::text[] then
      raise exception 'Hardware già in possesso';
    end if;
    v_max := public.zt_hw_cap(v_role);
    v_auto_equip := coalesce(array_length(v_equipped, 1), 0) < v_max;
    update public.profiles
    set
      creds = creds - v_price,
      owned_hardware = array_append(owned_hardware, p_item_id),
      equipped_hardware = case
        when v_auto_equip then array_append(v_equipped, p_item_id)
        else v_equipped
      end,
      equipment_cooldown_until = case
        when v_auto_equip then timezone('utc', now()) + interval '30 seconds'
        else equipment_cooldown_until
      end
    where id = v_actor;
  else
    if public.zt_software_inventory_len(v_inv) >= 3 then
      raise exception 'Inventario pieno (3 slot)';
    end if;
    v_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'itemId', p_item_id,
      'at', timezone('utc', now())
    );
    update public.profiles
    set
      creds = creds - v_price,
      inventory = coalesce(inventory, '[]'::jsonb) || jsonb_build_array(v_entry)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'kind', v_kind, 'item_id', p_item_id);
end;
$$;

grant execute on function public.afterlife_buy(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Farm / ICE: buff se l'ID è nell'array
-- -----------------------------------------------------------------------------
create or replace function public.complete_base_action(
  p_actor_slot_id uuid,
  p_node_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_node_name text;
  v_node_id uuid;
  v_role public.role_type;
  v_faction public.faction_type;
  v_hw text[];
  v_ice_delta int;
  v_ice_before int;
  v_ice_after int;
  v_gain int := 0;
  v_detail text;
  v_msg text;
  v_action text;
  v_logged boolean := false;
  v_log_err text;
  v_stealthed boolean := false;
  v_outcome text := 'success';
  v_owner public.faction_type;
  v_core_data boolean := false;
  v_faction_label text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select * into v_slot
  from public.slots
  where id = p_actor_slot_id
    and user_id = v_actor
    and action_type in ('attack', 'defend', 'farm', 'extract');

  if not found then
    raise exception 'Azione base non valida o già completata';
  end if;

  v_node_id := v_slot.node_id;
  v_action := v_slot.action_type::text;
  v_node_name := public.zt_node_label(v_node_id, p_node_name);
  v_stealthed := public.zt_is_stealthed(v_actor);

  select p.role, coalesce(p.equipped_hardware, '{}'::text[]), p.faction
  into v_role, v_hw, v_faction
  from public.profiles p where p.id = v_actor;

  v_ice_delta := case
    when v_hw @> array['heuristic']::text[] then 12
    else 10
  end;

  if v_action = 'attack' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before - v_ice_delta));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Attacco completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  elsif v_action = 'defend' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before + v_ice_delta));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Difesa completata — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  elsif v_action = 'farm' then
    v_gain := case when v_role = 'executive' then 60 else 30 end;
    if v_hw @> array['ram']::text[] then
      v_gain := round(v_gain * 1.2);
    end if;
    update public.profiles set creds = creds + v_gain where id = v_actor;
    v_detail := format('+%s ₵', v_gain);
    v_msg := format(
      'Successo: Farming completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  else
    select coalesce(n.ice, 0), n.owner_faction
    into v_ice_before, v_owner
    from public.nodes n
    where n.id = v_node_id
    for update;

    if v_ice_before > 20 then
      v_ice_after := v_ice_before;
      v_outcome := 'failure';
      v_detail := format('ICE %s%% > 20%% — estrazione fallita', v_ice_before);
      v_msg := format(
        'Fallito: Extract — %s — Server: %s [Slot %s]',
        v_detail, v_node_name, v_slot.slot_id::text
      );
    elsif v_owner is not null and v_owner = v_faction then
      v_ice_after := v_ice_before;
      v_outcome := 'failure';
      v_detail := 'server già sotto il controllo della tua fazione';
      v_msg := format(
        'Fallito: Extract — %s — Server: %s [Slot %s]',
        v_detail, v_node_name, v_slot.slot_id::text
      );
    elsif v_faction in ('security', 'hacktivist') then
      v_ice_after := 100;
      v_owner := v_faction;
      v_faction_label := case v_faction
        when 'security' then 'Corp'
        when 'hacktivist' then 'Rebel'
        else v_faction::text
      end;
      update public.nodes
      set ice = 100, owner_faction = v_faction, compromised = false
      where id = v_node_id;
      v_detail := format('Controllo %s · ICE 100%%', v_faction_label);
      v_msg := format(
        'Estrazione completata. Il server %s è stato riavviato e ora è sotto il controllo della fazione %s.',
        v_node_name,
        v_faction_label
      );
    else
      v_ice_after := 100;
      v_owner := 'consultant';
      v_core_data := true;
      update public.nodes
      set ice = 100, owner_faction = 'consultant', compromised = false
      where id = v_node_id;
      perform public.zt_grant_item(v_actor, 'core_data');
      v_detail := '+1 Core Data · Controllo Mercenary · ICE 100%';
      v_msg := format(
        'Estrazione completata. Il server %s è stato riavviato e ora è sotto il controllo della fazione Mercenary. +1 Core Data.',
        v_node_name
      );
    end if;
  end if;

  update public.slots
  set
    user_id = null, action_type = null, start_time = null, end_time = null,
    is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
    spoofed_action = null, target_slot_id = null
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  if not v_stealthed then
    begin
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_node_id, v_actor, null, v_action, v_msg, v_outcome,
        jsonb_build_object(
          'node_name', v_node_name,
          'slot', v_slot.slot_id::text,
          'ice_before', v_ice_before,
          'ice_after', v_ice_after,
          'gain', v_gain,
          'hardware', to_jsonb(v_hw),
          'owner_faction', v_owner,
          'core_data', v_core_data,
          'tone', case
            when v_outcome = 'failure' then 'danger'
            when v_action = 'attack' then 'info'
            when v_action = 'extract' then 'success'
            else 'success'
          end
        )
      );
      v_logged := true;
    exception when others then
      v_log_err := SQLERRM;
      raise warning 'complete_base_action log failed: %', v_log_err;
    end;
  end if;

  return jsonb_build_object(
    'ok', v_outcome = 'success',
    'logged', v_logged,
    'stealthed', v_stealthed,
    'action', v_action,
    'outcome', v_outcome,
    'detail', v_detail,
    'node_name', v_node_name,
    'slot', v_slot.slot_id::text,
    'ice_before', v_ice_before,
    'ice_after', v_ice_after,
    'gain', v_gain,
    'owner_faction', v_owner,
    'core_data', v_core_data,
    'log_error', v_log_err
  );
end;
$$;

grant execute on function public.complete_base_action(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Reset Totale: array vuoto, non null
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
