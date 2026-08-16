-- =============================================================================
-- ZERO TRUST — Fase 5: Log dettagliati + supporto alert (RLS insert)
-- Esegui nell'SQL Editor dopo phase4_schema.sql
-- =============================================================================

alter table public.logs
  add column if not exists outcome text not null default 'info';

-- Vincolo soft: valori attesi success | failure | aborted | info
comment on column public.logs.outcome is 'success | failure | aborted | info';

-- I client possono scrivere log solo come attori di se stessi
drop policy if exists "logs_insert_own_actor" on public.logs;
create policy "logs_insert_own_actor"
  on public.logs for insert
  to authenticated
  with check (actor_id = auth.uid());

-- Realtime già aggiunto in Fase 4; idempotente
do $$
begin
  alter publication supabase_realtime add table public.logs;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- Aggiorna RPC Trace: outcome esplicito (success / failure se segnale perso)
-- =============================================================================
create or replace function public.execute_trace(p_actor_slot_id uuid)
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

  v_revealed := 'Unknown';
  v_target_id := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
      if v_target.is_decoy and v_target.user_id is null then
        v_revealed := 'Unknown';
        v_outcome := 'success';
      elsif v_target.user_id is not null then
        select * into v_target_profile
        from public.profiles
        where id = v_target.user_id;

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

  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'trace',
    case
      when v_outcome = 'failure' then format('Trace fallito: %s', v_revealed)
      else format('Trace riuscito: %s', v_revealed)
    end,
    v_outcome,
    jsonb_build_object(
      'revealed', v_revealed,
      'actor_slot', v_slot.slot_id,
      'target_slot_id', v_slot.target_slot_id,
      'reason', case when v_outcome = 'failure' then 'target_fled_or_missing' else 'ok' end
    )
  );

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

  update public.profiles
  set status = 'idle'
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'revealed', v_revealed,
    'target_id', v_target_id,
    'outcome', v_outcome
  );
end;
$$;

-- =============================================================================
-- Aggiorna RPC Kick: failure se target è fuggito (abort)
-- =============================================================================
create or replace function public.execute_kick(p_actor_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_target public.slots%rowtype;
  v_target_id uuid;
  v_target_name text;
  v_outcome text := 'success';
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

  v_target_id := null;
  v_target_name := 'Unknown';

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found and v_target.user_id is not null then
      v_target_id := v_target.user_id;

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
      where id = v_target.id;

      select name into v_target_name from public.profiles where id = v_target_id;

      update public.profiles
      set
        is_blocked = true,
        status = 'idle'
      where id = v_target_id;

      v_outcome := 'success';
    else
      v_outcome := 'failure';
      v_target_name := 'bersaglio fuggito';
      -- Pulisci comunque decoy/slot vuoto residuo
      if found then
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
        where id = v_target.id;
      end if;
    end if;
  else
    v_outcome := 'failure';
    v_target_name := 'nessun bersaglio';
  end if;

  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'kick',
    case
      when v_outcome = 'success' then format('Kick riuscito su %s — account bloccato', coalesce(v_target_name, 'Unknown'))
      else format('Kick fallito: %s', v_target_name)
    end,
    v_outcome,
    jsonb_build_object(
      'target_slot_id', v_slot.target_slot_id,
      'actor_slot', v_slot.slot_id,
      'reason', case when v_outcome = 'failure' then 'target_fled_or_missing' else 'blocked' end
    )
  );

  -- Log lato vittima (stesso evento, messaggio dedicato) se kick riuscito
  if v_outcome = 'success' and v_target_id is not null then
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'kick_received',
      'Kick subito: azione interrotta e account BLOCKED',
      'success',
      jsonb_build_object('reason', 'kicked', 'from_slot', v_slot.slot_id)
    );
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
    target_slot_id = null
  where id = v_slot.id
    and user_id = v_actor;

  update public.profiles
  set status = 'idle'
  where id = v_actor;

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
