-- =============================================================================
-- ZERO TRUST — phase33: Extract asimmetrico + Auction House (Core Data)
-- Esegui nell'SQL Editor (dopo phase32).
--
-- Extract (ICE ≤ 20%, timer 5 min):
--   Corp (security) / Rebel (hacktivist): ownership fazione, ICE → 100%.
--     +1 VP/giorno dai server posseduti: cron successivo.
--   Merc (consultant): server Neutral, ICE → 100%, +1 Core Data in inventario.
-- Auction House:
--   Merc crea asta consumando 1 Core Data.
--   Corp/Rebel piazzano offerte (escrow immediato, rimborso se superati).
--   A scadenza: seller riceve current_bid; +1 Faction Score alla fazione del winner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema: ownership server + faction scores + auctions
-- -----------------------------------------------------------------------------
alter table public.nodes
  add column if not exists owner_faction public.faction_type;

comment on column public.nodes.owner_faction is
  'Fazione che controlla il server dopo Extract. NULL = Neutral (NPC).';

create table if not exists public.faction_scores (
  faction public.faction_type primary key,
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.faction_scores (faction, score)
values
  ('security', 0),
  ('hacktivist', 0),
  ('consultant', 0)
on conflict (faction) do nothing;

alter table public.faction_scores enable row level security;

grant select on table public.faction_scores to authenticated;

drop policy if exists faction_scores_select_authenticated on public.faction_scores;
create policy faction_scores_select_authenticated
  on public.faction_scores for select
  to authenticated
  using (true);

create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  start_price integer not null check (start_price > 0),
  highest_bidder_id uuid references public.profiles (id) on delete set null,
  current_bid integer not null default 0 check (current_bid >= 0),
  end_time timestamptz not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  constraint auctions_status_check check (status in ('OPEN', 'SOLD', 'EXPIRED')),
  constraint auctions_bidder_not_seller check (
    highest_bidder_id is null or highest_bidder_id <> seller_id
  ),
  constraint auctions_bid_vs_start check (
    current_bid = 0 or current_bid >= start_price
  )
);

create index if not exists auctions_status_end_idx
  on public.auctions (status, end_time);
create index if not exists auctions_seller_id_idx
  on public.auctions (seller_id);
create index if not exists auctions_highest_bidder_id_idx
  on public.auctions (highest_bidder_id);

alter table public.auctions enable row level security;

grant select on table public.auctions to authenticated;

drop policy if exists auctions_select_authenticated on public.auctions;
create policy auctions_select_authenticated
  on public.auctions for select
  to authenticated
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.auctions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.faction_scores;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Inventario: Core Data non occupa gli slot software (3)
-- -----------------------------------------------------------------------------
create or replace function public.zt_software_inventory_len(p_inv jsonb)
returns integer
language sql
immutable
as $$
  select coalesce((
    select count(*)::int
    from jsonb_array_elements(coalesce(p_inv, '[]'::jsonb)) e
    where coalesce(e->>'itemId', '') <> 'core_data'
  ), 0);
$$;

create or replace function public.zt_grant_item(p_user_id uuid, p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
begin
  perform set_config('row_security', 'off', true);

  v_entry := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'itemId', p_item_id,
    'at', timezone('utc', now())
  );

  update public.profiles
  set inventory = coalesce(inventory, '[]'::jsonb) || jsonb_build_array(v_entry)
  where id = p_user_id;

  return v_entry;
end;
$$;

create or replace function public.zt_add_faction_score(p_faction public.faction_type, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer;
begin
  perform set_config('row_security', 'off', true);

  insert into public.faction_scores (faction, score, updated_at)
  values (p_faction, greatest(0, p_delta), timezone('utc', now()))
  on conflict (faction) do update
    set
      score = public.faction_scores.score + p_delta,
      updated_at = timezone('utc', now());

  select score into v_score from public.faction_scores where faction = p_faction;
  return coalesce(v_score, 0);
end;
$$;

-- Shop: i Core Data non contano nel cap software
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
  v_equipped text;
  v_base int;
  v_price int;
  v_kind text;
  v_entry jsonb;
  v_auto_equip boolean := false;
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

  select reputation, creds, inventory, owned_hardware, equipped_hardware
  into v_rep, v_creds, v_inv, v_owned, v_equipped
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if v_kind = 'hardware' then
    if v_owned @> array[p_item_id]::text[] then
      raise exception 'Hardware già in possesso';
    end if;
    v_auto_equip := (v_equipped is null);
    update public.profiles
    set
      creds = creds - v_price,
      owned_hardware = array_append(owned_hardware, p_item_id),
      equipped_hardware = coalesce(equipped_hardware, p_item_id),
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

-- -----------------------------------------------------------------------------
-- Extract: complete_base_action ramifica per fazione
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
  v_stealthed boolean := false;
  v_outcome text := 'success';
  v_owner public.faction_type;
  v_core_data boolean := false;
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

  select p.role, p.equipped_hardware, p.faction
  into v_role, v_hw, v_faction
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
  elsif v_action = 'farm' then
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
  else
    -- extract
    select coalesce(n.ice, 0)
    into v_ice_before
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
    elsif v_faction in ('security', 'hacktivist') then
      v_ice_after := 100;
      v_owner := v_faction;
      update public.nodes
      set ice = 100, owner_faction = v_faction, compromised = false
      where id = v_node_id;
      v_detail := format(
        'Controllo %s · ICE 100%%',
        case v_faction
          when 'security' then 'Corp'
          when 'hacktivist' then 'Rebel'
          else v_faction::text
        end
      );
      v_msg := format(
        'Estrazione completata. Il server %s è stato riavviato e ora è sotto il controllo della fazione %s.',
        v_node_name,
        case v_faction
          when 'security' then 'Corp'
          when 'hacktivist' then 'Rebel'
          else v_faction::text
        end
      );
    else
      -- Mercenary: Neutral + Core Data, nessun VP fazione
      v_ice_after := 100;
      v_owner := null;
      v_core_data := true;
      update public.nodes
      set ice = 100, owner_faction = null, compromised = false
      where id = v_node_id;
      perform public.zt_grant_item(v_actor, 'core_data');
      v_detail := '+1 Core Data · server Neutral · ICE 100%';
      v_msg := format(
        'Successo: Extract — %s — Server: %s [Slot %s]',
        v_detail, v_node_name, v_slot.slot_id::text
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
          'hardware', v_hw,
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

-- -----------------------------------------------------------------------------
-- Auction House RPCs (escrow / rimborso / risoluzione)
-- -----------------------------------------------------------------------------
create or replace function public.zt_auction_apply_resolve(p_auction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.auctions%rowtype;
  v_bidder_faction public.faction_type;
  v_new_score integer := 0;
begin
  perform set_config('row_security', 'off', true);

  select * into v_row
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'Asta non trovata';
  end if;

  if v_row.status <> 'OPEN' then
    return jsonb_build_object('ok', true, 'status', v_row.status, 'already', true);
  end if;

  if v_row.end_time > timezone('utc', now()) then
    return jsonb_build_object('ok', true, 'status', 'OPEN', 'pending', true);
  end if;

  if v_row.highest_bidder_id is null or v_row.current_bid <= 0 then
    perform public.zt_grant_item(v_row.seller_id, 'core_data');
    update public.auctions
    set status = 'EXPIRED', resolved_at = timezone('utc', now())
    where id = p_auction_id;
    return jsonb_build_object('ok', true, 'status', 'EXPIRED', 'returned', true);
  end if;

  update public.profiles
  set creds = creds + v_row.current_bid
  where id = v_row.seller_id;

  select faction into v_bidder_faction
  from public.profiles
  where id = v_row.highest_bidder_id;

  if v_bidder_faction in ('security', 'hacktivist') then
    v_new_score := public.zt_add_faction_score(v_bidder_faction, 1);
  end if;

  update public.auctions
  set status = 'SOLD', resolved_at = timezone('utc', now())
  where id = p_auction_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'SOLD',
    'paid', v_row.current_bid,
    'winner_faction', v_bidder_faction,
    'faction_score', v_new_score
  );
end;
$$;

create or replace function public.auction_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  perform set_config('row_security', 'off', true);

  for v_id in
    select id
    from public.auctions
    where status = 'OPEN'
      and end_time <= timezone('utc', now())
    for update skip locked
  loop
    perform public.zt_auction_apply_resolve(v_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'resolved', v_count);
end;
$$;

create or replace function public.auction_create(
  p_start_price integer,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_faction public.faction_type;
  v_blocked boolean;
  v_id uuid;
begin
  perform set_config('row_security', 'off', true);
  perform public.auction_sweep();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  if p_start_price is null or p_start_price < 10 then
    raise exception 'Prezzo di partenza minimo: 10 ₵';
  end if;
  if p_start_price > 5000 then
    raise exception 'Prezzo di partenza massimo: 5000 ₵';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 60 or p_duration_seconds > 86400 then
    raise exception 'Durata non valida (60s–24h)';
  end if;

  select faction, is_blocked
  into v_faction, v_blocked
  from public.profiles
  where id = v_actor
  for update;

  if v_blocked then
    raise exception 'Account bloccato: vai all’Helpdesk';
  end if;
  if v_faction is distinct from 'consultant' then
    raise exception 'Solo i Mercenary possono mettere all’asta Core Data';
  end if;

  if not public.zt_consume_item(v_actor, 'core_data') then
    raise exception 'Serve 1× Core Data in inventario';
  end if;

  insert into public.auctions (
    seller_id, start_price, current_bid, end_time, status
  ) values (
    v_actor,
    p_start_price,
    0,
    timezone('utc', now()) + (p_duration_seconds::text || ' seconds')::interval,
    'OPEN'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'auction_id', v_id);
end;
$$;

create or replace function public.auction_bid(p_auction_id uuid, p_bid integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_faction public.faction_type;
  v_blocked boolean;
  v_frozen timestamptz;
  v_creds int;
  v_row public.auctions%rowtype;
  v_min int;
  v_prev uuid;
  v_prev_bid int;
  v_delta int;
begin
  perform set_config('row_security', 'off', true);
  perform public.auction_sweep();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;
  if p_bid is null or p_bid <= 0 then
    raise exception 'Offerta non valida';
  end if;

  select faction, is_blocked, frozen_until, creds
  into v_faction, v_blocked, v_frozen, v_creds
  from public.profiles
  where id = v_actor
  for update;

  if v_blocked then
    raise exception 'Account bloccato: vai all’Helpdesk';
  end if;
  if v_frozen is not null and v_frozen > timezone('utc', now()) then
    raise exception 'Asset Freeze: non puoi spendere crediti per 24h.';
  end if;
  if v_faction not in ('security', 'hacktivist') then
    raise exception 'Solo Corp e Rebel possono piazzare offerte';
  end if;

  select * into v_row
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'Asta non trovata';
  end if;
  if v_row.status <> 'OPEN' then
    raise exception 'Asta già chiusa';
  end if;
  if v_row.end_time <= timezone('utc', now()) then
    perform public.zt_auction_apply_resolve(v_row.id);
    raise exception 'Asta scaduta';
  end if;
  if v_row.seller_id = v_actor then
    raise exception 'Non puoi offrire sulla tua asta';
  end if;

  if v_row.highest_bidder_id is null or v_row.current_bid <= 0 then
    v_min := v_row.start_price;
  else
    v_min := v_row.current_bid + 1;
  end if;

  if p_bid < v_min then
    raise exception 'Offerta minima: % ₵', v_min;
  end if;

  if v_row.highest_bidder_id is not distinct from v_actor then
    v_delta := p_bid - v_row.current_bid;
    if v_creds < v_delta then
      raise exception 'Crediti insufficienti (servono % ₵)', v_delta;
    end if;
    update public.profiles
    set creds = creds - v_delta
    where id = v_actor;
    update public.auctions
    set current_bid = p_bid
    where id = v_row.id;
    return jsonb_build_object(
      'ok', true,
      'current_bid', p_bid,
      'raised', true,
      'escrowed', v_delta
    );
  end if;

  if v_creds < p_bid then
    raise exception 'Crediti insufficienti (servono % ₵)', p_bid;
  end if;

  v_prev := v_row.highest_bidder_id;
  v_prev_bid := v_row.current_bid;

  update public.profiles
  set creds = creds - p_bid
  where id = v_actor;

  if v_prev is not null and v_prev_bid > 0 then
    update public.profiles
    set creds = creds + v_prev_bid
    where id = v_prev;
  end if;

  update public.auctions
  set highest_bidder_id = v_actor, current_bid = p_bid
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'current_bid', p_bid,
    'refunded_to', v_prev,
    'refunded', case when v_prev is not null then v_prev_bid else 0 end,
    'escrowed', p_bid
  );
end;
$$;

grant execute on function public.zt_software_inventory_len(jsonb) to authenticated, service_role;
grant execute on function public.zt_grant_item(uuid, text) to authenticated, service_role;
grant execute on function public.zt_add_faction_score(public.faction_type, integer) to authenticated, service_role;
grant execute on function public.afterlife_buy(text) to authenticated;
grant execute on function public.complete_base_action(uuid, text) to authenticated;
grant execute on function public.zt_auction_apply_resolve(uuid) to authenticated, service_role;
grant execute on function public.auction_sweep() to authenticated;
grant execute on function public.auction_create(integer, integer) to authenticated;
grant execute on function public.auction_bid(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
