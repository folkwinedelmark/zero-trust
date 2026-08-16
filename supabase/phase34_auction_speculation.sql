-- =============================================================================
-- ZERO TRUST — phase34: Aste globali, bidding Mercenary, risoluzione speculativa
-- Esegui nell'SQL Editor (dopo phase33).
-- =============================================================================

-- Risoluzione: Corp/Rebel → +1 VP fazione. Merc → +1 Core Data. Seller prende i ₵.
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
  v_core_returned boolean := false;
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
  elsif v_bidder_faction = 'consultant' then
    perform public.zt_grant_item(v_row.highest_bidder_id, 'core_data');
    v_core_returned := true;
  end if;

  update public.auctions
  set status = 'SOLD', resolved_at = timezone('utc', now())
  where id = p_auction_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'SOLD',
    'paid', v_row.current_bid,
    'winner_faction', v_bidder_faction,
    'faction_score', v_new_score,
    'core_data', v_core_returned
  );
end;
$$;

-- Creazione: log globale visibile a tutti
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
  v_msg text;
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

  v_msg := format(
    '[ASTA GLOBALE] Un nuovo Core Data è stato inserito nel Black Market. Base d''asta: %s ₵.',
    p_start_price
  );

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'auction_global',
      v_msg,
      'info',
      jsonb_build_object(
        'tone', 'warning',
        'start_price', p_start_price,
        'auction_id', v_id
      ),
      true
    );
  exception when others then
    raise warning 'auction_create log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'auction_id', v_id);
end;
$$;

-- Bidding: tutte le fazioni (Corp / Rebel / Merc speculatori)
create or replace function public.auction_bid(p_auction_id uuid, p_bid integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
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

  select is_blocked, frozen_until, creds
  into v_blocked, v_frozen, v_creds
  from public.profiles
  where id = v_actor
  for update;

  if v_blocked then
    raise exception 'Account bloccato: vai all’Helpdesk';
  end if;
  if v_frozen is not null and v_frozen > timezone('utc', now()) then
    raise exception 'Asset Freeze: non puoi spendere crediti per 24h.';
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

grant execute on function public.zt_auction_apply_resolve(uuid) to authenticated, service_role;
grant execute on function public.auction_create(integer, integer) to authenticated;
grant execute on function public.auction_bid(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
