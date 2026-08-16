-- =============================================================================
-- ZERO TRUST — phase19: Afterlife Hub (reputation, heat, inventory, hardware)
-- Esegui nell'SQL Editor (dopo phase18).
-- Poi ri-esegui phase16_kick_intel.sql e phase18_trace_reveal.sql
-- (Bailout Token su Kick, Signal Jammer su Trace).
-- =============================================================================

-- Profilo: economia / suspicion / loadout
alter table public.profiles
  add column if not exists reputation integer not null default 3;

alter table public.profiles
  add column if not exists heat integer not null default 0;

alter table public.profiles
  add column if not exists inventory jsonb not null default '[]'::jsonb;

alter table public.profiles
  add column if not exists owned_hardware text[] not null default '{}';

alter table public.profiles
  add column if not exists equipped_hardware text;

alter table public.profiles drop constraint if exists profiles_reputation_range;
alter table public.profiles
  add constraint profiles_reputation_range check (reputation between 1 and 5);

alter table public.profiles drop constraint if exists profiles_heat_range;
alter table public.profiles
  add constraint profiles_heat_range check (heat between 0 and 5);

alter table public.profiles drop constraint if exists profiles_pa_check;
alter table public.profiles
  add constraint profiles_pa_check check (pa >= 0 and pa <= 4);

-- Effetti software sul mondo
alter table public.nodes
  add column if not exists ddos_until timestamptz;

alter table public.slots
  add column if not exists locked_until timestamptz;

-- -----------------------------------------------------------------------------
-- Prezzo in funzione della reputation
-- -----------------------------------------------------------------------------
create or replace function public.zt_calc_price(p_base integer, p_reputation integer)
returns integer
language sql
immutable
as $$
  select greatest(0, round(
    p_base * (1 + case least(5, greatest(1, coalesce(p_reputation, 3)))
      when 5 then -0.20
      when 4 then -0.10
      when 3 then 0
      when 2 then 0.10
      else 0.20
    end
  )::numeric)::integer);
$$;

create or replace function public.zt_item_base_price(p_item_id text)
returns integer
language sql
immutable
as $$
  select case p_item_id
    when 'unlock' then 100
    when 'wipe' then 200
    when 'coffee' then 300
    when 'ram' then 300
    when 'gps' then 500
    when 'crypto_nic' then 400
    when 'heuristic' then 600
    when 'ddos' then 150
    when 'bailout' then 250
    when 'intel' then 100
    when 'jammer' then 150
    when 'lockout' then 150
    when 'wiper' then 120
    else null
  end;
$$;

create or replace function public.zt_consume_item(p_user_id uuid, p_item_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv jsonb;
  v_idx int;
  v_entry jsonb;
begin
  perform set_config('row_security', 'off', true);

  select inventory into v_inv from public.profiles where id = p_user_id for update;
  if v_inv is null then
    return false;
  end if;

  select ordinality - 1, elem
  into v_idx, v_entry
  from jsonb_array_elements(v_inv) with ordinality as t(elem, ordinality)
  where elem->>'itemId' = p_item_id
  limit 1;

  if v_idx is null then
    return false;
  end if;

  select jsonb_agg(elem)
  into v_inv
  from (
    select elem
    from jsonb_array_elements(v_inv) with ordinality as t(elem, ordinality)
    where ordinality - 1 <> v_idx
  ) s;

  update public.profiles
  set inventory = coalesce(v_inv, '[]'::jsonb)
  where id = p_user_id;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helpdesk istantaneo
-- -----------------------------------------------------------------------------
create or replace function public.afterlife_helpdesk(p_service text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rep int;
  v_creds int;
  v_blocked boolean;
  v_heat int;
  v_pa int;
  v_base int;
  v_price int;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_base := public.zt_item_base_price(p_service);
  if v_base is null or p_service not in ('unlock', 'wipe', 'coffee') then
    raise exception 'Servizio Helpdesk non valido';
  end if;

  select reputation, creds, is_blocked, heat, pa
  into v_rep, v_creds, v_blocked, v_heat, v_pa
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);

  if p_service = 'unlock' and not v_blocked then
    raise exception 'Account già operativo';
  end if;
  if p_service = 'wipe' and v_heat <= 0 then
    raise exception 'Heat già a zero';
  end if;
  if p_service = 'coffee' and v_pa >= 4 then
    raise exception 'Operazione negata: Hai già i PA al massimo.';
  end if;
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if p_service = 'unlock' then
    update public.profiles
    set creds = creds - v_price, is_blocked = false
    where id = v_actor;
  elsif p_service = 'wipe' then
    update public.profiles
    set creds = creds - v_price, heat = 0
    where id = v_actor;
  else
    update public.profiles
    set creds = creds - v_price, pa = least(4, pa + 1)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'service', p_service);
end;
$$;

-- -----------------------------------------------------------------------------
-- Acquisto hardware / software
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
  v_base int;
  v_price int;
  v_kind text;
  v_entry jsonb;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

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

  select reputation, creds, inventory, owned_hardware
  into v_rep, v_creds, v_inv, v_owned
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if v_kind = 'hardware' then
    if v_owned @> array[p_item_id]::text[] then
      raise exception 'Hardware già in possesso';
    end if;
    update public.profiles
    set
      creds = creds - v_price,
      owned_hardware = array_append(owned_hardware, p_item_id),
      equipped_hardware = coalesce(equipped_hardware, p_item_id)
    where id = v_actor;
  else
    if jsonb_array_length(coalesce(v_inv, '[]'::jsonb)) >= 3 then
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

create or replace function public.afterlife_sell(p_inventory_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_inv jsonb;
  v_entry jsonb;
  v_item text;
  v_base int;
  v_next jsonb;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select inventory into v_inv from public.profiles where id = v_actor for update;

  select elem into v_entry
  from jsonb_array_elements(coalesce(v_inv, '[]'::jsonb)) elem
  where elem->>'id' = p_inventory_id
  limit 1;

  if v_entry is null then
    raise exception 'Item non trovato in inventario';
  end if;

  v_item := v_entry->>'itemId';
  v_base := public.zt_item_base_price(v_item);
  if v_base is null then
    raise exception 'Item non vendibile';
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_inv) elem
  where elem->>'id' <> p_inventory_id;

  update public.profiles
  set inventory = v_next, creds = creds + v_base
  where id = v_actor;

  return jsonb_build_object('ok', true, 'refund', v_base, 'item_id', v_item);
end;
$$;

create or replace function public.afterlife_equip(p_hardware_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owned text[];
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select owned_hardware into v_owned from public.profiles where id = v_actor;
  if v_owned is null or not (v_owned @> array[p_hardware_id]::text[]) then
    raise exception 'Non possiedi questo hardware';
  end if;

  update public.profiles set equipped_hardware = p_hardware_id where id = v_actor;
  return jsonb_build_object('ok', true, 'equipped', p_hardware_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Uso software (target)
-- -----------------------------------------------------------------------------
create or replace function public.afterlife_use_item(
  p_inventory_id text,
  p_target_id uuid default null,
  p_target_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_inv jsonb;
  v_entry jsonb;
  v_item text;
  v_node public.nodes%rowtype;
  v_slot public.slots%rowtype;
  v_target public.profiles%rowtype;
  v_node_name text;
  v_next jsonb;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select inventory into v_inv from public.profiles where id = v_actor for update;
  select elem into v_entry
  from jsonb_array_elements(coalesce(v_inv, '[]'::jsonb)) elem
  where elem->>'id' = p_inventory_id
  limit 1;

  if v_entry is null then
    raise exception 'Item non in inventario';
  end if;

  v_item := v_entry->>'itemId';
  if v_item in ('bailout', 'jammer') then
    raise exception 'Item passivo: si attiva da solo';
  end if;

  if v_item = 'intel' then
    if p_target_id is null then
      raise exception 'Seleziona un agente';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;
    if v_target.current_node_id is not null then
      select name into v_node_name from public.nodes where id = v_target.current_node_id;
    end if;

  elsif v_item = 'ddos' then
    if p_target_id is null then
      raise exception 'Seleziona un server';
    end if;
    select * into v_node from public.nodes where id = p_target_id and type = 'server';
    if not found then
      raise exception 'Nodo non valido';
    end if;
    update public.nodes
    set ddos_until = timezone('utc', now()) + interval '15 minutes'
    where id = v_node.id;
    v_node_name := v_node.name;

  elsif v_item = 'lockout' then
    if p_target_slot_id is null then
      raise exception 'Seleziona uno slot vuoto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    if v_slot.user_id is not null or v_slot.is_decoy then
      raise exception 'Lo slot non è vuoto';
    end if;
    update public.slots
    set locked_until = timezone('utc', now()) + interval '10 minutes'
    where id = v_slot.id;
    select name into v_node_name from public.nodes where id = v_slot.node_id;

  elsif v_item = 'wiper' then
    if p_target_id is null then
      raise exception 'Seleziona un nodo';
    end if;
    select * into v_node from public.nodes where id = p_target_id;
    if not found then
      raise exception 'Nodo non trovato';
    end if;
    update public.logs
    set
      message = regexp_replace(message, v_actor::text, 'Unknown', 'g'),
      meta = coalesce(meta, '{}'::jsonb)
        || jsonb_build_object('wiped', true, 'revealed', 'Unknown', 'display_name', 'Unknown')
    where node_id = v_node.id
      and created_at >= timezone('utc', now()) - interval '24 hours'
      and (
        actor_id = v_actor
        or target_id = v_actor
        or coalesce(meta->>'revealed', '') in (
          select p.name from public.profiles p where p.id = v_actor
        )
      );
    -- Anonimizza handle noto nei messaggi
    update public.logs l
    set message = regexp_replace(
      l.message,
      (select p.name from public.profiles p where p.id = v_actor),
      'Unknown',
      'gi'
    )
    where l.node_id = v_node.id
      and l.created_at >= timezone('utc', now()) - interval '24 hours';
    v_node_name := v_node.name;
  else
    raise exception 'Item non utilizzabile';
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_inv) elem
  where elem->>'id' <> p_inventory_id;

  update public.profiles set inventory = v_next where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_item,
    'node_name', v_node_name,
    'target_name', case when v_item = 'intel' then v_target.name else null end,
    'located', (v_item = 'intel'),
    'current_node', v_node_name
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Hardware: farm +20% RAM · ICE ±12 Heuristic
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
  v_hw text;
  v_ice_delta int;
  v_ice_before int;
  v_ice_after int;
  v_gain int := 0;
  v_detail text;
  v_msg text;
  v_action text;
  v_logged boolean := false;
  v_log_err text;
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
    and action_type in ('attack', 'defend', 'farm');

  if not found then
    raise exception 'Azione base non valida o già completata';
  end if;

  v_node_id := v_slot.node_id;
  v_action := v_slot.action_type::text;
  v_node_name := public.zt_node_label(v_node_id, p_node_name);

  select p.role, p.equipped_hardware
  into v_role, v_hw
  from public.profiles p where p.id = v_actor;

  v_ice_delta := case
    when v_hw = 'heuristic' then 12
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
  else
    v_gain := case when v_role = 'executive' then 60 else 30 end;
    if v_hw = 'ram' then
      v_gain := round(v_gain * 1.2);
    end if;
    update public.profiles set creds = creds + v_gain where id = v_actor;
    v_detail := format('+%s ₵', v_gain);
    v_msg := format(
      'Successo: Farming completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  end if;

  update public.slots
  set
    user_id = null, action_type = null, start_time = null, end_time = null,
    is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
    spoofed_action = null, target_slot_id = null
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_node_id, v_actor, null, v_action, v_msg, 'success',
      jsonb_build_object(
        'node_name', v_node_name,
        'slot', v_slot.slot_id::text,
        'ice_before', v_ice_before,
        'ice_after', v_ice_after,
        'gain', v_gain,
        'hardware', v_hw,
        'tone', case when v_action = 'attack' then 'info' else 'success' end
      )
    );
    v_logged := true;
  exception when others then
    v_log_err := SQLERRM;
    raise warning 'complete_base_action log failed: %', v_log_err;
  end;

  return jsonb_build_object(
    'ok', true,
    'logged', v_logged,
    'action', v_action,
    'detail', v_detail,
    'node_name', v_node_name,
    'slot', v_slot.slot_id::text,
    'ice_before', v_ice_before,
    'ice_after', v_ice_after,
    'gain', v_gain,
    'log_error', v_log_err
  );
end;
$$;

grant execute on function public.zt_calc_price(integer, integer) to authenticated;
grant execute on function public.afterlife_helpdesk(text) to authenticated;
grant execute on function public.afterlife_buy(text) to authenticated;
grant execute on function public.afterlife_sell(text) to authenticated;
grant execute on function public.afterlife_equip(text) to authenticated;
grant execute on function public.afterlife_use_item(text, uuid, uuid) to authenticated;
grant execute on function public.complete_base_action(uuid, text) to authenticated;

notify pgrst, 'reload schema';
