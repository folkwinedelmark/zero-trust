-- =============================================================================
-- ZERO TRUST — phase73: Ghost Heat leak + Trace notify at start
-- Esegui nell'SQL Editor (dopo phase72).
--
-- 1. Heat +1 solo se l'identità è stata realmente rivelata.
--    Ghost + esecutore non-Analyst → nessun Heat (niente leak sulla user list).
--    Analyst pierce (o bersaglio non-Ghost) → +1 Heat.
-- 2. Notifica/log alla vittima all'AVVIO del Trace, non a fine timer.
-- =============================================================================

create or replace function public.zt_notify_trace_started(
  p_actor_id uuid,
  p_node_id uuid,
  p_target_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_victim uuid;
  v_slot_label text;
  v_node_name text;
  v_msg constant text :=
    'ATTENZIONE: Rilevato tentativo di tracciamento (Trace) in corso sul tuo nodo.';
begin
  if p_actor_id is null or p_target_slot_id is null then
    return;
  end if;

  select s.user_id, s.slot_id::text
  into v_victim, v_slot_label
  from public.slots s
  where s.id = p_target_slot_id;

  if v_victim is null or v_victim is not distinct from p_actor_id then
    return;
  end if;

  v_node_name := public.zt_node_label(p_node_id, null);

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta
    ) values (
      p_node_id,
      p_actor_id,
      v_victim,
      'trace_incoming',
      v_msg,
      'info',
      jsonb_build_object(
        'tone', 'warning',
        'perspective', 'target',
        'node_name', v_node_name,
        'target_slot', v_slot_label,
        'compromised_slot', v_slot_label
      )
    );
  exception when others then
    raise warning 'zt_notify_trace_started log failed: %', SQLERRM;
  end;

  begin
    perform public.zt_insert_notification(v_victim, 'ATTENZIONE', v_msg);
  exception when others then
    raise warning 'zt_notify_trace_started notify failed: %', SQLERRM;
  end;
end;
$$;

revoke execute on function public.zt_notify_trace_started(uuid, uuid, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- start_action: avvisa la vittima quando parte un Trace
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
  v_apply_shield boolean := false;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_slot_action_allowed(p_action_type, p_target_slot_id);

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

  v_apply_shield :=
    coalesce(v_profile.has_legal_shield, false)
    and p_action_type in ('attack', 'defend', 'farm');

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
    target_slot_id = p_target_slot_id,
    is_immune = v_apply_shield
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
    current_node_id = v_slot.node_id,
    has_legal_shield = case
      when v_apply_shield then false
      else has_legal_shield
    end
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
      target_slot_id = null,
      is_immune = false
    where id = v_slot.id
      and user_id = v_actor;
    raise exception 'Impossibile passare a BUSY.';
  end if;

  if p_action_type = 'trace' then
    perform public.zt_notify_trace_started(
      v_actor,
      v_slot.node_id,
      p_target_slot_id
    );
  end if;

  return jsonb_build_object(
    'collided', false,
    'claimed', to_jsonb(v_claimed),
    'pa_cost', v_cost,
    'legal_shield_applied', v_apply_shield
  );
end;
$$;

grant execute on function public.start_action(
  uuid, public.action_type, timestamptz, timestamptz, uuid, uuid, integer
) to authenticated;

-- -----------------------------------------------------------------------------
-- execute_trace: Heat solo se identità rivelata; niente notify a fine timer
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
  v_actor_role public.role_type;
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

  select role into v_actor_role from public.profiles where id = v_actor;

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
          v_revealed := public.zt_ghost_revealed_name(v_target_profile, v_actor);
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

  -- Heat solo se l'identità è stata realmente rivelata.
  -- Ghost + non-Analyst → ENCRYPTED ID, niente +1 Heat (leak sulla user list).
  if v_target_id is not null and v_outcome = 'success' then
    if v_target_profile.role is distinct from 'ghost'
       or v_actor_role is not distinct from 'analyst' then
      update public.profiles
      set heat = least(5, coalesce(heat, 0) + 1)
      where id = v_target_id;
    end if;
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
        else
          format(
            'Trace completato con successo. Bersaglio identificato: %s. Azione in corso: %s.',
            v_revealed,
            coalesce(v_action_label, 'UNKNOWN')
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

grant execute on function public.execute_trace(uuid, text) to authenticated;

-- Fine timer: niente push "Trace started" su trace_received (resta Kick / abilità).
create or replace function public.zt_notify_hostile_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ability text;
  v_result text;
begin
  if NEW.target_id is null or NEW.target_id is not distinct from NEW.actor_id then
    return NEW;
  end if;

  if NEW.event_type = 'kick_received'
     and coalesce(NEW.outcome, 'success') = 'success' then
    perform public.zt_insert_notification(
      NEW.target_id,
      '⚠️ VIOLAZIONE DI SICUREZZA',
      'Sei stato bersagliato da un''operazione ostile sulla rete.'
    );
    return NEW;
  end if;

  if NEW.event_type = 'ability' then
    v_ability := coalesce(NEW.meta ->> 'ability_id', '');
    v_result := coalesce(NEW.meta ->> 'result', '');
    if v_ability = 'deep_scan'
       or (v_ability = 'kill_process' and v_result = 'kicked') then
      perform public.zt_insert_notification(
        NEW.target_id,
        '⚠️ VIOLAZIONE DI SICUREZZA',
        'Sei stato bersagliato da un''operazione ostile sulla rete.'
      );
    end if;
  end if;

  return NEW;
end;
$$;

notify pgrst, 'reload schema';
