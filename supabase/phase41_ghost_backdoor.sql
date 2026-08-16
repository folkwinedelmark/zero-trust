-- =============================================================================
-- ZERO TRUST — phase41: Ghost Slot D permanente + Decoy contestuale
-- Esegui nell'SQL Editor (dopo phase40).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Slot D permanente su ogni server
-- -----------------------------------------------------------------------------
create or replace function public.zt_ensure_server_backdoors()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
begin
  insert into public.slots (node_id, slot_id, is_backdoor)
  select n.id, 'D'::public.slot_label, true
  from public.nodes n
  where n.type = 'server'
    and not exists (
      select 1
      from public.slots s
      where s.node_id = n.id
        and s.slot_id = 'D'::public.slot_label
    );
  get diagnostics v_inserted = row_count;

  update public.slots
  set
    is_backdoor = true,
    backdoor_until = null,
    backdoor_owner_id = null
  where slot_id = 'D'::public.slot_label;

  return v_inserted;
end;
$$;

select public.zt_ensure_server_backdoors();

-- Sweep: i decoy scadono, Slot D non si cancella più
create or replace function public.zt_sweep_class_effects()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decoys int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

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
    target_slot_id = null
  where is_decoy
    and end_time is not null
    and end_time <= timezone('utc', now());
  get diagnostics v_decoys = row_count;

  perform public.zt_ensure_server_backdoors();

  return jsonb_build_object('ok', true, 'decoys_cleared', v_decoys, 'backdoors_cleared', 0);
end;
$$;

-- Solo i Ghost occupano Slot D (qualsiasi Ghost, non un owner temporaneo)
create or replace function public.zt_enforce_backdoor_owner()
returns trigger
language plpgsql
as $$
declare
  v_role public.role_type;
begin
  if NEW.is_backdoor
     and NEW.user_id is not null
     and NEW.user_id is distinct from OLD.user_id then
    select role into v_role from public.profiles where id = NEW.user_id;
    if v_role is distinct from 'ghost' then
      raise exception 'Solo i Ghost possono usare Slot D';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_slots_backdoor_owner on public.slots;
create trigger trg_slots_backdoor_owner
  before update of user_id on public.slots
  for each row
  execute function public.zt_enforce_backdoor_owner();

-- Decoy su Slot D: +1 PA (stessa transazione di use_ability → rollback se PA insufficienti)
create or replace function public.zt_charge_backdoor_decoy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_updated int;
begin
  if NEW.is_backdoor
     and NEW.is_decoy
     and not coalesce(OLD.is_decoy, false) then
    if v_actor is null then
      return NEW;
    end if;
    update public.profiles
    set pa = pa - 1
    where id = v_actor
      and pa >= 1;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'PA insufficienti per Slot D (+1 PA)';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_slots_backdoor_decoy on public.slots;
create trigger trg_slots_backdoor_decoy
  before update of is_decoy on public.slots
  for each row
  execute function public.zt_charge_backdoor_decoy();

-- Catalogo: Backdoor non è più un'abilità cliccabile
create or replace function public.zt_ability_def(p_ability_id text)
returns table (
  ability_id text,
  required_role public.role_type,
  pa_cost integer,
  cooldown interval
)
language sql
immutable
as $$
  select
    d.ability_id,
    d.required_role,
    d.pa_cost,
    d.cooldown
  from (
    values
      ('hotfix',          'sysadmin'::public.role_type, 1, interval '24 hours'),
      ('kill_process',    'sysadmin',                   1, interval '24 hours'),
      ('hard_reboot',     'sysadmin',                   3, interval '7 days'),
      ('decoy',           'ghost',                      1, interval '24 hours'),
      ('identity_spoof',  'ghost',                      3, interval '7 days'),
      ('deep_scan',       'analyst',                    1, interval '24 hours'),
      ('background_check','analyst',                    1, interval '24 hours'),
      ('doxxing',         'analyst',                    3, interval '7 days'),
      ('immunity',        'executive',                  1, interval '24 hours'),
      ('nda',             'executive',                  1, interval '24 hours'),
      ('asset_freeze',    'executive',                  3, interval '7 days')
  ) as d(ability_id, required_role, pa_cost, cooldown)
  where d.ability_id = p_ability_id;
$$;

-- -----------------------------------------------------------------------------
-- start_action: claim slot + PA (base + 1 se Slot D)
-- -----------------------------------------------------------------------------
create or replace function public.start_action(
  p_slot_id uuid,
  p_action_type public.action_type,
  p_start timestamptz,
  p_end timestamptz,
  p_target_slot_id uuid default null,
  p_node_id uuid default null,
  p_base_pa integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_slot public.slots%rowtype;
  v_node public.nodes%rowtype;
  v_cost int;
  v_claimed public.slots%rowtype;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_daytime();

  select * into v_profile
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;
  if v_profile.is_blocked then
    raise exception 'Account BLOCKED';
  end if;
  if v_profile.status is distinct from 'idle' then
    raise exception 'Impossibile passare a BUSY.';
  end if;

  select * into v_slot
  from public.slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Slot non trovato';
  end if;
  if v_slot.user_id is not null or v_slot.is_decoy then
    return jsonb_build_object('collided', true);
  end if;
  if v_slot.locked_until is not null and v_slot.locked_until > timezone('utc', now()) then
    raise exception 'Slot locked';
  end if;
  if v_slot.is_backdoor and v_profile.role is distinct from 'ghost' then
    raise exception 'Solo i Ghost possono usare Slot D';
  end if;

  if p_node_id is not null and v_slot.node_id is distinct from p_node_id then
    raise exception 'Slot non appartiene a questo server';
  end if;

  select * into v_node from public.nodes where id = v_slot.node_id;
  if not found or v_node.type is distinct from 'server' then
    raise exception 'Server non valido';
  end if;

  if p_action_type = 'extract' then
    if coalesce(v_node.ice, 0) > 20 then
      raise exception 'Extract disponibile solo con ICE ≤ 20%%.';
    end if;
    if v_node.owner_faction is not null
       and v_profile.faction is not null
       and v_node.owner_faction = v_profile.faction then
      raise exception 'Non puoi estrarre un server già sotto il controllo della tua fazione.';
    end if;
  end if;

  if coalesce(p_base_pa, 1) <= 0 then
    v_cost := 0;
  else
    v_cost := 1;
    if v_slot.is_backdoor then
      v_cost := v_cost + 1;
    end if;
  end if;

  if v_profile.pa < v_cost then
    raise exception 'PA insufficienti (servono % PA)', v_cost;
  end if;

  update public.slots
  set
    user_id = v_actor,
    action_type = p_action_type,
    start_time = p_start,
    end_time = p_end,
    is_decoy = false,
    is_spoofed = false,
    spoofed_as_user_id = null,
    spoofed_action = null,
    target_slot_id = p_target_slot_id
  where id = v_slot.id
    and user_id is null
    and not is_decoy
  returning * into v_claimed;

  if not found then
    return jsonb_build_object('collided', true);
  end if;

  update public.profiles
  set
    status = 'busy',
    pa = pa - v_cost,
    current_node_id = v_slot.node_id
  where id = v_actor
    and status = 'idle'
    and is_blocked = false;

  if not found then
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
      target_slot_id = null
    where id = v_slot.id
      and user_id = v_actor;
    raise exception 'Impossibile passare a BUSY.';
  end if;

  return jsonb_build_object(
    'collided', false,
    'claimed', to_jsonb(v_claimed),
    'pa_cost', v_cost
  );
end;
$$;

grant execute on function public.start_action(
  uuid, public.action_type, timestamptz, timestamptz, uuid, uuid, integer
) to authenticated;

grant execute on function public.zt_ensure_server_backdoors() to authenticated;

-- Reset totale: dopo lo sweep, ricrea Slot D
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
    backdoor_owner_id = null
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
