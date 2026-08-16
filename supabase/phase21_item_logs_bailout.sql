-- =============================================================================
-- ZERO TRUST — phase21: log item con nomi nodo/slot + Bailout passivo su Kick
-- Esegui nell'SQL Editor (dopo phase19 e phase20).
-- =============================================================================

alter table public.profiles
  add column if not exists stealth_until timestamptz;

create or replace function public.zt_is_stealthed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.stealth_until is not null
      and p.stealth_until > timezone('utc', now())
  );
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
    when 'wiper' then 350
    else null
  end;
$$;

-- Consume 1 item dall'inventario jsonb (itemId). Usato da Kick (bailout) e Trace (jammer).
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
-- Uso software: ritorna node/slot e scrive il log con i nomi reali
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
        'Target %s localizzato su %s. — Server: %s',
        v_target.name, v_node_name, v_node_name
      );
    else
      v_node_id := null;
      v_node_name := null;
      v_msg := format(
        'Target %s è attualmente nella Global Network (Mappa/Hub).',
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
      'Successo: %s attivato su %s. — Server: %s',
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
      raise exception 'Lo slot non è vuoto';
    end if;
    update public.slots
    set locked_until = timezone('utc', now()) + interval '10 minutes'
    where id = v_slot.id;
    v_node_id := v_slot.node_id;
    v_slot_label := v_slot.slot_id::text;
    select name into v_node_name from public.nodes where id = v_slot.node_id;
    v_msg := format(
      'Successo: %s attivato sullo Slot %s di %s. — Server: %s [Slot %s]',
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

-- -----------------------------------------------------------------------------
-- Kick: Bailout Token passivo evita is_blocked e scrive i due log
-- -----------------------------------------------------------------------------
create or replace function public.execute_kick(
  p_actor_slot_id uuid,
  p_known_handle text default null,
  p_node_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_slot public.slots%rowtype;
  v_target public.slots%rowtype;
  v_target_found boolean := false;
  v_target_id uuid;
  v_target_name text;
  v_intel_handle text;
  v_has_intel boolean := false;
  v_display_name text;
  v_node_name text;
  v_target_action text;
  v_target_slot_label text;
  v_session_start timestamptz;
  v_aimed_id uuid;
  v_outcome text := 'failure';
  v_bailed boolean := false;
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
    and action_type = 'kick';

  if not found then
    raise exception 'Kick non valido o già completato';
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor;
  v_node_name := public.zt_node_label(v_slot.node_id, p_node_name);

  v_target_id := null;
  v_target_name := null;
  v_target_action := null;
  v_target_slot_label := null;
  v_session_start := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;
    v_target_found := found;

    if v_target_found then
      v_target_slot_label := v_target.slot_id::text;
      v_target_action := v_target.action_type::text;
      v_session_start := v_target.start_time;
    end if;

    if v_target_found and v_target.user_id is not null then
      v_target_id := v_target.user_id;
      select p.name into v_target_name from public.profiles p where p.id = v_target_id;

      -- Bailout prima dello sgombero: se c'è il token, il kick fallisce e il
      -- bersaglio resta sullo slot, busy, non bloccato. Il token si consuma.
      if public.zt_consume_item(v_target_id, 'bailout') then
        v_bailed := true;
        v_outcome := 'failure';
      else
        update public.slots
        set
          user_id = null, action_type = null, start_time = null, end_time = null,
          is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
          spoofed_action = null, target_slot_id = null
        where id = v_target.id;

        update public.slots
        set
          user_id = null, action_type = null, start_time = null, end_time = null,
          is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
          spoofed_action = null, target_slot_id = null
        where user_id = v_target_id;

        update public.profiles
        set is_blocked = true, status = 'idle',
            heat = least(5, coalesce(heat, 0) + 2)
        where id = v_target_id;

        v_outcome := 'success';
      end if;
    end if;
  end if;

  v_aimed_id := v_target_id;
  if v_aimed_id is null then
    select l.target_id
    into v_aimed_id
    from public.logs l
    where l.actor_id = v_actor
      and l.event_type = 'kick_incoming'
      and l.target_id is not null
      and l.created_at >= v_slot.start_time - interval '15 seconds'
      and l.created_at <= timezone('utc', now()) + interval '5 seconds'
      and (l.node_id is null or l.node_id = v_slot.node_id)
    order by l.created_at desc
    limit 1;
  end if;

  v_intel_handle := public.zt_lookup_kick_intel(
    v_actor,
    v_slot.target_slot_id,
    v_aimed_id,
    v_session_start,
    v_slot.start_time
  );
  v_has_intel := v_intel_handle is not null;

  if not v_has_intel then
    p_known_handle := null;
  elsif coalesce(nullif(trim(both from coalesce(p_known_handle, '')), ''), '') = '' then
    p_known_handle := v_intel_handle;
  end if;

  if v_has_intel then
    v_display_name := coalesce(v_intel_handle, 'Unknown');
  else
    v_display_name := 'Unknown';
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
      v_slot.node_id,
      v_actor,
      case when v_has_intel then v_target_id else null end,
      'kick',
      case
        when v_bailed then
          format(
            'Fallito: Kick vanificato su %s — Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. — Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_outcome = 'success' then
          format(
            'Successo: Kick eseguito con successo su %s — account BLOCKED — Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        else
          format(
            'Fallito: Kick vanificato su %s — Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
      end,
      v_outcome,
      jsonb_build_object(
        'node_name', v_node_name,
        'actor_slot', v_slot.slot_id::text,
        'target_slot', v_target_slot_label,
        'target_slot_id', v_slot.target_slot_id,
        'compromised_slot', v_target_slot_label,
        'compromised_action', case when v_has_intel then v_target_action else null end,
        'target_action', case when v_has_intel then v_target_action else null end,
        'display_name', v_display_name,
        'intel_handle', v_intel_handle,
        'has_intel', v_has_intel,
        'unmasked', false,
        'known_handle', p_known_handle,
        'bailed', v_bailed,
        'tone', case
          when v_bailed then 'warning'
          when v_outcome = 'success' then 'info'
          else 'danger'
        end
      )
    );

    if v_bailed and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_target_id,
        v_actor,
        'bailout_consumed',
        format(
          'Bailout Token consumato automaticamente: Kick e blocco account evitati su %s. — Server: %s',
          v_node_name, v_node_name
        ),
        'success',
        jsonb_build_object(
          'node_name', v_node_name,
          'compromised_slot', v_target_slot_label,
          'tone', 'success',
          'item_id', 'bailout'
        )
      );

      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        case when v_has_intel then v_target_id else null end,
        'bailout_averted',
        format(
          'Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. — Server: %s [Slot %s]',
          v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
        ),
        'failure',
        jsonb_build_object(
          'node_name', v_node_name,
          'target_slot', v_target_slot_label,
          'tone', 'warning',
          'has_intel', v_has_intel,
          'bailed', true
        )
      );
    elsif v_outcome = 'success' and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        v_target_id,
        'kick_received',
        format(
          'Kick subito da %s%s — account BLOCKED — Server: %s [Slot %s]',
          coalesce(v_actor_name, 'agente'),
          case when v_target_action is not null
            then format(' — operazione di %s interrotta', v_target_action)
            else '' end,
          v_node_name,
          coalesce(v_target_slot_label, '?')
        ),
        'success',
        jsonb_build_object(
          'node_name', v_node_name,
          'compromised_slot', v_target_slot_label,
          'compromised_action', v_target_action,
          'target_action', v_target_action,
          'tone', 'danger',
          'perspective', 'target'
        )
      );
    end if;
  exception when others then
    raise warning 'execute_kick log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'blocked', (v_outcome = 'success' and not v_bailed),
    'bailed', v_bailed,
    'outcome', v_outcome,
    'target_id', case when v_has_intel then v_target_id else null end,
    'target_name', v_display_name,
    'has_intel', v_has_intel,
    'intel_handle', v_intel_handle,
    'unmasked', false,
    'node_name', v_node_name,
    'target_slot', v_target_slot_label
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Trace: Jammer passivo avvisa anche il difensore
-- -----------------------------------------------------------------------------
create or replace function public.execute_trace(
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
  v_target public.slots%rowtype;
  v_target_profile public.profiles%rowtype;
  v_node_name text;
  v_revealed text;
  v_target_id uuid;
  v_target_action text;
  v_action_label text;
  v_target_slot_label text;
  v_outcome text := 'success';
  v_jammed boolean := false;
  v_untraceable boolean := false;
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
    and action_type = 'trace';

  if not found then
    raise exception 'Trace non valido o già completato';
  end if;

  v_node_name := public.zt_node_label(v_slot.node_id, p_node_name);

  v_revealed := 'Unknown';
  v_target_id := null;
  v_target_action := null;
  v_action_label := null;
  v_target_slot_label := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
      v_target_slot_label := v_target.slot_id::text;
      v_target_action := v_target.action_type::text;

      if v_target.is_decoy and v_target.user_id is null then
        v_revealed := 'Unknown';
        v_outcome := 'success';
      elsif v_target.user_id is not null then
        select * into v_target_profile from public.profiles where id = v_target.user_id;
        if found then
          v_target_id := v_target_profile.id;
          if v_target_profile.role = 'ghost' then
            v_revealed := 'ID CRIPTATO';
          else
            v_revealed := v_target_profile.name;
          end if;
          v_outcome := 'success';
        end if;
      else
        v_revealed := 'Unknown';
        v_outcome := 'failure';
      end if;
    else
      v_revealed := 'Unknown';
      v_outcome := 'failure';
    end if;
  else
    v_outcome := 'failure';
  end if;

  if v_target_id is not null and v_outcome = 'success' then
    if public.zt_is_stealthed(v_target_id) then
      v_untraceable := true;
      v_revealed := 'Unknown';
      v_target_action := null;
      v_outcome := 'failure';
    elsif public.zt_consume_item(v_target_id, 'jammer') then
      v_jammed := true;
      v_revealed := 'Unknown';
      v_target_action := null;
      v_outcome := 'failure';
    end if;
  end if;

  if v_target_id is not null and v_outcome = 'success' then
    update public.profiles
    set heat = least(5, coalesce(heat, 0) + 1)
    where id = v_target_id;
  end if;

  v_action_label := case v_target_action
    when 'attack' then 'Attacco'
    when 'defend' then 'Difesa'
    when 'farm' then 'Farming'
    when 'extract' then 'Extract'
    when 'trace' then 'Trace'
    when 'kick' then 'Kick'
    else v_target_action
  end;

  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      case when v_jammed or v_untraceable then null else v_target_id end,
      'trace',
      case
        when v_untraceable then
          format(
            'Fallito: Bersaglio digitalmente non tracciabile. — Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_jammed then
          format(
            'Fallito: Trace fallito: rilevata interferenza di rete. — Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_outcome = 'failure' then
          format(
            'Fallito: Trace (segnale perso) — Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_action_label is not null then
          format(
            'Successo: Trace completato su %s — azione: %s — Server: %s [Slot %s]',
            v_revealed, v_action_label, v_node_name,
            coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        else
          format(
            'Successo: Trace completato su %s — Server: %s [Slot %s]',
            v_revealed, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
      end,
      v_outcome,
      jsonb_build_object(
        'revealed', v_revealed,
        'actor_slot', v_slot.slot_id::text,
        'target_slot', v_target_slot_label,
        'target_slot_id', v_slot.target_slot_id,
        'target_action', v_target_action,
        'compromised_slot', v_target_slot_label,
        'compromised_action', v_target_action,
        'node_name', v_node_name,
        'jammed', v_jammed,
        'untraceable', v_untraceable,
        'tone', case when v_outcome = 'failure' then 'danger' else 'info' end
      )
    );

    if v_jammed and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_target_id,
        v_actor,
        'jammer_consumed',
        format(
          'Signal Jammer consumato automaticamente: Trace in arrivo bloccato su %s. — Server: %s',
          v_node_name, v_node_name
        ),
        'success',
        jsonb_build_object(
          'node_name', v_node_name,
          'compromised_slot', v_target_slot_label,
          'tone', 'success',
          'item_id', 'jammer'
        )
      );
    elsif v_target_id is not null and v_outcome = 'success' then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        v_target_id,
        'trace_received',
        format(
          'Subito Trace%s — Server: %s [Slot %s]%s',
          case when v_action_label is not null
            then format(' mentre eseguivi %s', v_action_label)
            else '' end,
          v_node_name,
          coalesce(v_target_slot_label, '?'),
          case when v_revealed = 'ID CRIPTATO'
            then ' — Stealth: ID CRIPTATO'
            else ' — identità esposta' end
        ),
        'success',
        jsonb_build_object(
          'revealed', v_revealed,
          'node_name', v_node_name,
          'target_slot', v_target_slot_label,
          'compromised_slot', v_target_slot_label,
          'compromised_action', v_target_action,
          'target_action', v_target_action,
          'tone', 'warning',
          'perspective', 'target'
        )
      );
    end if;
  exception when others then
    raise warning 'execute_trace log failed: %', SQLERRM;
  end;

  update public.slots
  set user_id = null, action_type = null, start_time = null, end_time = null,
      is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
      spoofed_action = null, target_slot_id = null
  where id = v_slot.id and user_id = v_actor;

  update public.profiles set status = 'idle' where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'revealed', v_revealed,
    'target_id', v_target_id,
    'outcome', v_outcome,
    'jammed', v_jammed,
    'untraceable', v_untraceable,
    'target_slot_id', v_slot.target_slot_id,
    'target_slot', v_target_slot_label,
    'target_action', v_target_action,
    'node_name', v_node_name,
    'actor_slot', v_slot.slot_id::text
  );
end;
$$;

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
  v_stealthed boolean := false;
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
  v_stealthed := public.zt_is_stealthed(v_actor);

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

  if not v_stealthed then
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
  end if;

  return jsonb_build_object(
    'ok', true,
    'logged', v_logged,
    'stealthed', v_stealthed,
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

grant execute on function public.zt_is_stealthed(uuid) to authenticated, service_role;
grant execute on function public.complete_base_action(uuid, text) to authenticated;
grant execute on function public.zt_consume_item(uuid, text) to authenticated, service_role;
grant execute on function public.afterlife_use_item(text, uuid, uuid) to authenticated;
grant execute on function public.execute_kick(uuid, text, text) to authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
