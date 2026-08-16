-- =============================================================================
-- ZERO TRUST — phase20: travel persistente + cooldown equip
-- Esegui nell'SQL Editor (dopo phase19).
-- =============================================================================

alter type public.player_status add value if not exists 'traveling';

alter table public.profiles
  add column if not exists equipment_cooldown_until timestamptz;

alter table public.profiles
  add column if not exists travel_until timestamptz;

alter table public.profiles
  add column if not exists travel_intent jsonb;

create or replace function public.afterlife_equip(p_hardware_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owned text[];
  v_current text;
  v_cd timestamptz;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select owned_hardware, equipped_hardware, equipment_cooldown_until
  into v_owned, v_current, v_cd
  from public.profiles
  where id = v_actor
  for update;

  if v_owned is null or not (v_owned @> array[p_hardware_id]::text[]) then
    raise exception 'Non possiedi questo hardware';
  end if;

  if v_current is not distinct from p_hardware_id then
    return jsonb_build_object('ok', true, 'equipped', p_hardware_id, 'unchanged', true);
  end if;

  if v_cd is not null and v_cd > timezone('utc', now()) then
    raise exception 'Equip in cooldown (% s)',
      greatest(1, ceil(extract(epoch from (v_cd - timezone('utc', now())))))::int;
  end if;

  update public.profiles
  set
    equipped_hardware = p_hardware_id,
    equipment_cooldown_until = timezone('utc', now()) + interval '30 seconds'
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'equipped', p_hardware_id,
    'cooldown_seconds', 30
  );
end;
$$;

-- Primo acquisto hardware: stesso cooldown se equipaggia in automatico
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

grant execute on function public.afterlife_equip(text) to authenticated;
grant execute on function public.afterlife_buy(text) to authenticated;

notify pgrst, 'reload schema';
