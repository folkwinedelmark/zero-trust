-- =============================================================================
-- ZERO TRUST — Intelligence logs bidirezionali (Trace / Kick)
-- Esegui dopo phase5 + phase6.
-- =============================================================================

create or replace function public.execute_trace(p_actor_slot_id uuid)
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
  v_target_profile public.profiles%rowtype;
  v_node_name text;
  v_revealed text;
  v_target_id uuid;
  v_outcome text := 'success';
begin
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

  if v_slot.end_time is not null and v_slot.end_time > timezone('utc', now()) then
    raise exception 'Trace ancora in corso';
  end if;

  select name into v_actor_name from public.profiles where id = v_actor;
  select name into v_node_name from public.nodes where id = v_slot.node_id;
  v_node_name := coalesce(v_node_name, 'Server');

  v_revealed := 'Unknown';
  v_target_id := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
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
        v_revealed := 'Segnale perso';
        v_outcome := 'failure';
      end if;
    else
      v_revealed := 'Segnale perso';
      v_outcome := 'failure';
    end if;
  else
    v_revealed := 'Nessun bersaglio';
    v_outcome := 'failure';
  end if;

  -- Log attaccante
  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'trace',
    case
      when v_outcome = 'failure' then
        format('Trace fallito su %s (Slot %s): bersaglio fuggito o segnale perso', v_node_name, v_slot.slot_id)
      when v_revealed = 'ID CRIPTATO' then
        format('Trace completato su %s: identità = ID CRIPTATO (Ghost)', v_node_name)
      else
        format('Trace completato su %s: identità = %s', v_node_name, v_revealed)
    end,
    v_outcome,
    jsonb_build_object(
      'revealed', v_revealed,
      'actor_slot', v_slot.slot_id,
      'target_slot_id', v_slot.target_slot_id,
      'node_name', v_node_name,
      'tone', case when v_outcome = 'failure' then 'danger' else 'info' end,
      'reason', case when v_outcome = 'failure' then 'target_fled_or_missing' else 'ok' end
    )
  );

  -- Log bersaglio (se ancora identificabile)
  if v_target_id is not null then
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'trace_received',
      case
        when v_revealed = 'ID CRIPTATO' then
          format('Subito Trace su %s — Stealth Protocol attivo (ID CRIPTATO verso l''attaccante)', v_node_name)
        else
          format('Subito Trace su %s — la tua identità è stata esposta', v_node_name)
      end,
      'success',
      jsonb_build_object(
        'revealed', v_revealed,
        'node_name', v_node_name,
        'tone', 'warning',
        'perspective', 'target'
      )
    );
  end if;

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
    'outcome', v_outcome
  );
end;
$$;

create or replace function public.execute_kick(p_actor_slot_id uuid)
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
  v_target_id uuid;
  v_target_name text;
  v_node_name text;
  v_outcome text := 'success';
  v_had_target_id uuid;
begin
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

  if v_slot.end_time is not null and v_slot.end_time > timezone('utc', now()) then
    raise exception 'Kick ancora in corso';
  end if;

  select name into v_actor_name from public.profiles where id = v_actor;
  select name into v_node_name from public.nodes where id = v_slot.node_id;
  v_node_name := coalesce(v_node_name, 'Server');

  v_target_id := null;
  v_target_name := 'Unknown';
  v_had_target_id := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found and v_target.user_id is not null then
      v_target_id := v_target.user_id;
      v_had_target_id := v_target.user_id;

      update public.slots
      set user_id = null, action_type = null, start_time = null, end_time = null,
          is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
          spoofed_action = null, target_slot_id = null
      where id = v_target.id;

      select name into v_target_name from public.profiles where id = v_target_id;

      update public.profiles
      set is_blocked = true, status = 'idle'
      where id = v_target_id;

      v_outcome := 'success';
    else
      v_outcome := 'failure';
      v_target_name := 'bersaglio fuggito';
      if found then
        update public.slots
        set user_id = null, action_type = null, start_time = null, end_time = null,
            is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
            spoofed_action = null, target_slot_id = null
        where id = v_target.id;
      end if;
    end if;
  else
    v_outcome := 'failure';
    v_target_name := 'nessun bersaglio';
  end if;

  -- Log attaccante
  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'kick',
    case
      when v_outcome = 'success' then
        format('Kick riuscito su %s (%s) — account BLOCKED', coalesce(v_target_name, 'Unknown'), v_node_name)
      else
        format('Kick vanificato su %s: %s (Abort o fuga)', v_node_name, v_target_name)
    end,
    v_outcome,
    jsonb_build_object(
      'target_slot_id', v_slot.target_slot_id,
      'actor_slot', v_slot.slot_id,
      'node_name', v_node_name,
      'tone', case when v_outcome = 'success' then 'info' else 'danger' end,
      'reason', case when v_outcome = 'failure' then 'target_fled_or_missing' else 'blocked' end
    )
  );

  -- Log vittima (solo kick a segno)
  if v_outcome = 'success' and v_target_id is not null then
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'kick_received',
      format('Kick subito da %s su %s — azione interrotta, account BLOCKED', coalesce(v_actor_name, 'agente'), v_node_name),
      'success',
      jsonb_build_object(
        'reason', 'kicked',
        'node_name', v_node_name,
        'tone', 'danger',
        'perspective', 'target'
      )
    );
  end if;

  update public.slots
  set user_id = null, action_type = null, start_time = null, end_time = null,
      is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
      spoofed_action = null, target_slot_id = null
  where id = v_slot.id and user_id = v_actor;

  update public.profiles set status = 'idle' where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'target_id', v_target_id,
    'target_name', v_target_name,
    'outcome', v_outcome
  );
end;
$$;

grant execute on function public.execute_trace(uuid) to authenticated;
grant execute on function public.execute_kick(uuid) to authenticated;
