-- =============================================================================
-- ZERO TRUST — phase74: early alerts for Kick + Deep Scan
-- Esegui nell'SQL Editor (dopo phase73).
--
-- Stessa logica del Trace: la vittima è avvisata all'AVVIO del timer, non
-- a fine azione. Completamento = solo log di esito (kick riuscito / scan
-- riuscito), niente push generico "sei stato bersagliato".
-- =============================================================================

create or replace function public.zt_notify_hostile_started(
  p_actor_id uuid,
  p_node_id uuid,
  p_target_slot_id uuid,
  p_action text
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
  v_kind text := lower(btrim(coalesce(p_action, '')));
  v_event text;
  v_title text;
  v_msg text;
begin
  if p_actor_id is null or p_target_slot_id is null then
    return;
  end if;

  if v_kind = 'trace' then
    v_event := 'trace_incoming';
    v_title := 'ATTENZIONE';
    v_msg :=
      'ATTENZIONE: Rilevato tentativo di tracciamento (Trace) in corso sul tuo nodo.';
  elsif v_kind = 'kick' then
    v_event := 'kick_incoming';
    v_title := 'ALLARME';
    v_msg :=
      'ALLARME: Tentativo di espulsione (Kick) in corso sul tuo nodo.';
  elsif v_kind = 'deep_scan' then
    v_event := 'deep_scan_incoming';
    v_title := 'ATTENZIONE';
    v_msg :=
      'ATTENZIONE: Rilevata scansione profonda (Deep Scan) in corso sul tuo nodo.';
  else
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
      v_event,
      v_msg,
      'info',
      jsonb_build_object(
        'tone', 'warning',
        'perspective', 'target',
        'node_name', v_node_name,
        'target_slot', v_slot_label,
        'compromised_slot', v_slot_label,
        'action_type', v_kind
      )
    );
  exception when others then
    raise warning 'zt_notify_hostile_started log failed: %', SQLERRM;
  end;

  begin
    perform public.zt_insert_notification(v_victim, v_title, v_msg);
  exception when others then
    raise warning 'zt_notify_hostile_started notify failed: %', SQLERRM;
  end;
end;
$$;

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
begin
  perform public.zt_notify_hostile_started(
    p_actor_id,
    p_node_id,
    p_target_slot_id,
    'trace'
  );
end;
$$;

revoke execute on function public.zt_notify_hostile_started(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.zt_notify_trace_started(uuid, uuid, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- start_action: Trace / Kick / Deep Scan → alert vittima all'avvio
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

  if p_action_type in ('trace', 'kick', 'deep_scan') then
    perform public.zt_notify_hostile_started(
      v_actor,
      v_slot.node_id,
      p_target_slot_id,
      p_action_type::text
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

-- Deep Scan è un'abilità (timer client / use_ability): stesso alert all'avvio.
create or replace function public.use_ability(
  p_ability_id text,
  p_target_id uuid default null,
  p_target_slot_id uuid default null,
  p_node_id uuid default null,
  p_ice_sign integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node_id uuid;
  v_victim uuid;
begin
  if p_ability_id = 'immunity' then
    return public.zt_activate_legal_shield();
  end if;

  if p_ability_id = 'deep_scan' and p_target_slot_id is not null then
    select s.node_id, s.user_id
    into v_node_id, v_victim
    from public.slots s
    where s.id = p_target_slot_id;

    if v_victim is not null then
      perform public.zt_notify_hostile_started(
        auth.uid(),
        coalesce(p_node_id, v_node_id),
        p_target_slot_id,
        'deep_scan'
      );
    end if;
  end if;

  return public.use_ability_legacy(
    p_ability_id,
    p_target_id,
    p_target_slot_id,
    p_node_id,
    p_ice_sign
  );
end;
$$;

grant execute on function public.use_ability(text, uuid, uuid, uuid, integer)
  to authenticated;

-- Completamento: niente push generico su Kick/Deep Scan.
-- Resta Kill Process (istantaneo) e i log di esito (kick_received / deep_scan_received).
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

  if NEW.event_type = 'ability' then
    v_ability := coalesce(NEW.meta ->> 'ability_id', '');
    v_result := coalesce(NEW.meta ->> 'result', '');
    if v_ability = 'kill_process' and v_result = 'kicked' then
      perform public.zt_insert_notification(
        NEW.target_id,
        '⚠️ VIOLAZIONE DI SICUREZZA',
        'Sei stato espulso dal server da un SysAdmin tramite l''abilità Kill Process.'
      );
    end if;
  end if;

  return NEW;
end;
$$;

notify pgrst, 'reload schema';
