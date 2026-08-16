-- =============================================================================
-- ZERO TRUST — phase51: Black Market depreciation (sell = 50% base)
-- Esegui nell'SQL Editor (dopo phase50).
-- =============================================================================

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
  v_refund int;
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

  v_refund := floor(v_base * 0.5)::int;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_inv) elem
  where elem->>'id' <> p_inventory_id;

  update public.profiles
  set inventory = v_next, creds = creds + v_refund
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'refund', v_refund,
    'item_id', v_item,
    'base_price', v_base
  );
end;
$$;

grant execute on function public.afterlife_sell(text) to authenticated;

notify pgrst, 'reload schema';
