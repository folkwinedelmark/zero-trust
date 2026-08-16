-- ZERO TRUST — phase23: Intel Package location (slot vs Global Network)
-- Esegui nell'SQL Editor (idempotente).

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
  v_item_name text;
  v_node public.nodes%rowtype;
  v_slot public.slots%rowtype;
  v_target public.profiles%rowtype;
  v_node_name text;
  v_node_id uuid;
  v_slot_label text;
  v_next jsonb;
  v_msg text;
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

  v_item_name := case v_item
    when 'ddos' then 'DDoS Script'
    when 'lockout' then 'Lockout Script'
    when 'wiper' then 'Wiper Scrubber'
    when 'intel' then 'Intel Package'
    else v_item
  end;

  if v_item = 'intel' then
    if p_target_id is null then
      raise exception 'Seleziona un agente';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;

    -- Posizione reale: slot occupato su un server, altrimenti connessione idle
    -- a un server. Travel / mappa / Hub non sono un server.
    select s.node_id, n.name
    into v_node_id, v_node_name
    from public.slots s
    join public.nodes n on n.id = s.node_id
    where s.user_id = v_target.id
      and n.type = 'server'
    limit 1;

    if v_node_id is null
       and v_target.status = 'idle'
       and v_target.current_node_id is not null then
      select n.id, n.name
      into v_node_id, v_node_name
      from public.nodes n
      where n.id = v_target.current_node_id
        and n.type = 'server';
    end if;

    if v_node_name is not null then
      v_msg := format(
        'Target %s localizzato su %s. â€” Server: %s',
        v_target.name, v_node_name, v_node_name
      );
    else
      v_node_id := null;
      v_node_name := null;
      v_msg := format(
        'Target %s Ã¨ attualmente nella Global Network (Mappa/Hub).',
        v_target.name
      );
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
    v_node_id := v_node.id;
    v_node_name := v_node.name;
    v_msg := format(
      'Successo: %s attivato su %s. â€” Server: %s',
      v_item_name, v_node_name, v_node_name
    );

  elsif v_item = 'lockout' then
    if p_target_slot_id is null then
      raise exception 'Seleziona uno slot vuoto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    if v_slot.user_id is not null or v_slot.is_decoy then
      raise exception 'Lo slot non Ã¨ vuoto';
    end if;
    update public.slots
    set locked_until = timezone('utc', now()) + interval '10 minutes'
    where id = v_slot.id;
    v_node_id := v_slot.node_id;
    v_slot_label := v_slot.slot_id::text;
    select name into v_node_name from public.nodes where id = v_slot.node_id;
    v_msg := format(
      'Successo: %s attivato sullo Slot %s di %s. â€” Server: %s [Slot %s]',
      v_item_name, v_slot_label, v_node_name, v_node_name, v_slot_label
    );

  elsif v_item = 'wiper' then
    v_msg := 'Wiper Scrubber attivo: Impronta digitale mascherata per 3 minuti.';
  else
    raise exception 'Item non utilizzabile';
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_inv) elem
  where elem->>'id' <> p_inventory_id;

  if v_item = 'wiper' then
    update public.profiles
    set
      inventory = v_next,
      stealth_until = timezone('utc', now()) + interval '3 minutes'
    where id = v_actor;
  else
    update public.profiles set inventory = v_next where id = v_actor;
  end if;

  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_node_id,
      v_actor,
      case when v_item = 'intel' then p_target_id else null end,
      'afterlife_use',
      v_msg,
      'success',
      jsonb_build_object(
        'item_id', v_item,
        'item_name', v_item_name,
        'node_name', v_node_name,
        'slot', v_slot_label,
        'tone', 'success'
      )
    );
  exception when others then
    raise warning 'afterlife_use_item log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_item,
    'item_name', v_item_name,
    'node_id', v_node_id,
    'node_name', v_node_name,
    'slot_label', v_slot_label,
    'target_name', case when v_item = 'intel' then v_target.name else null end,
    'target_id', case when v_item = 'intel' then p_target_id else null end,
    'located', (v_item = 'intel'),
    'on_server', (v_item = 'intel' and v_node_name is not null),
    'current_node', v_node_name,
    'message', v_msg,
    'logged', true
  );
end;
$$;

grant execute on function public.afterlife_use_item(text, uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
