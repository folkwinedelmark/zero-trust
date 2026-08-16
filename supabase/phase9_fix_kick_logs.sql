-- =============================================================================
-- ZERO TRUST — Fix Kick + harden RPC (rimuove overload / check end_time troppo stretto)
-- Esegui nell'SQL Editor. Sostituisce execute_kick / rafforza execute_trace.
-- =============================================================================

-- Rimuovi overload ambigui (causa tipica: RPC Kick che non parte dal client)
drop function if exists public.execute_kick(uuid);
drop function if exists public.execute_kick(uuid, text);

create or replace function public.execute_kick(
  p_actor_slot_id uuid,
  p_known_handle text default null
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
  v_target_id uuid;
  v_target_name text;
  v_display_name text;
  v_node_name text;
  v_target_action text;
  v_target_slot_label text;
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

  -- Tollera skew di clock client/server (prima bloccava il Kick a fine timer)
  -- Nessun reject aggressivo su end_time: il client ha già atteso.

  select name into v_actor_name from public.profiles where id = v_actor;
  select name into v_node_name from public.nodes where id = v_slot.node_id;
  v_node_name := coalesce(v_node_name, 'Server');

  v_target_id := null;
  v_target_name := null;
  v_target_action := null;
  v_target_slot_label := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
      v_target_slot_label := v_target.slot_id::text;
      v_target_action := v_target.action_type::text;
    end if;

    if found and v_target.user_id is not null then
      v_target_id := v_target.user_id;

      -- 1) Espelli il bersaglio dallo slot
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

      -- Sicurezza: libera eventuali altri slot del target
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
      where user_id = v_target_id;

      select name into v_target_name from public.profiles where id = v_target_id;

      -- 2) Blocca account + IDLE
      update public.profiles
      set
        is_blocked = true,
        status = 'idle'
      where id = v_target_id;

      v_outcome := 'success';
    else
      v_outcome := 'failure';
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
  end if;

  v_display_name := coalesce(
    nullif(trim(both from coalesce(v_target_name, '')), ''),
    nullif(trim(both from coalesce(p_known_handle, '')), ''),
    'Unknown'
  );

  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'kick',
    case
      when v_outcome = 'success' then
        format(
          'Successo: Kick eseguito su %s — account BLOCKED — Server: %s [Slot %s]',
          v_display_name,
          v_node_name,
          coalesce(v_target_slot_label, v_slot.slot_id::text)
        )
      else
        format(
          'Fallito: Kick vanificato su %s (fuga/Abort) — Server: %s [Slot %s]',
          v_display_name,
          v_node_name,
          coalesce(v_target_slot_label, v_slot.slot_id::text)
        )
    end,
    v_outcome,
    jsonb_build_object(
      'target_slot_id', v_slot.target_slot_id,
      'target_slot', v_target_slot_label,
      'actor_slot', v_slot.slot_id,
      'node_name', v_node_name,
      'known_handle', p_known_handle,
      'display_name', v_display_name,
      'target_action', v_target_action,
      'compromised_slot', v_target_slot_label,
      'compromised_action', v_target_action,
      'tone', case when v_outcome = 'success' then 'info' else 'danger' end,
      'reason', case when v_outcome = 'failure' then 'target_fled_or_missing' else 'blocked' end
    )
  );

  if v_outcome = 'success' and v_target_id is not null then
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'kick_received',
      case
        when v_target_action is not null then
          format(
            'Kick subito da %s — operazione di %s interrotta, account BLOCKED — Server: %s [Slot %s]',
            coalesce(v_actor_name, 'agente'),
            v_target_action,
            v_node_name,
            coalesce(v_target_slot_label, '?')
          )
        else
          format(
            'Kick subito da %s — account BLOCKED — Server: %s [Slot %s]',
            coalesce(v_actor_name, 'agente'),
            v_node_name,
            coalesce(v_target_slot_label, '?')
          )
      end,
      'success',
      jsonb_build_object(
        'reason', 'kicked',
        'node_name', v_node_name,
        'target_slot', v_target_slot_label,
        'compromised_slot', v_target_slot_label,
        'compromised_action', v_target_action,
        'target_action', v_target_action,
        'tone', 'danger',
        'perspective', 'target'
      )
    );
  end if;

  -- 3) Libera lo slot del kicker + IDLE
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
    'target_name', v_display_name,
    'outcome', v_outcome,
    'node_name', v_node_name,
    'target_slot', v_target_slot_label,
    'blocked', (v_outcome = 'success')
  );
end;
$$;

-- Trace: stesso allentamento sul check end_time
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
  v_node_name text;
  v_revealed text;
  v_target_id uuid;
  v_target_action text;
  v_target_slot_label text;
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

  select name into v_node_name from public.nodes where id = v_slot.node_id;
  v_node_name := coalesce(v_node_name, 'Server');

  v_revealed := 'Unknown';
  v_target_id := null;
  v_target_action := null;
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

  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'trace',
    case
      when v_outcome = 'failure' then
        format(
          'Fallito: Trace (segnale perso) — Server: %s [Slot %s]',
          v_node_name,
          coalesce(v_target_slot_label, v_slot.slot_id::text)
        )
      else
        format(
          'Successo: Trace completato su %s — Server: %s [Slot %s]',
          v_revealed,
          v_node_name,
          coalesce(v_target_slot_label, v_slot.slot_id::text)
        )
    end,
    v_outcome,
    jsonb_build_object(
      'revealed', v_revealed,
      'actor_slot', v_slot.slot_id,
      'target_slot', v_target_slot_label,
      'target_slot_id', v_slot.target_slot_id,
      'target_action', v_target_action,
      'compromised_slot', v_target_slot_label,
      'compromised_action', v_target_action,
      'node_name', v_node_name,
      'tone', case when v_outcome = 'failure' then 'danger' else 'info' end
    )
  );

  if v_target_id is not null and v_outcome = 'success' then
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'trace_received',
      case
        when v_target_action is not null then
          format(
            'Subito Trace mentre eseguivi %s — Server: %s [Slot %s]%s',
            v_target_action,
            v_node_name,
            coalesce(v_target_slot_label, '?'),
            case when v_revealed = 'ID CRIPTATO' then ' — Stealth: ID CRIPTATO' else ' — identità esposta' end
          )
        else
          format(
            'Subito Trace — Server: %s [Slot %s]%s',
            v_node_name,
            coalesce(v_target_slot_label, '?'),
            case when v_revealed = 'ID CRIPTATO' then ' — Stealth: ID CRIPTATO' else ' — identità esposta' end
          )
      end,
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
    'target_slot_id', v_slot.target_slot_id,
    'target_slot', v_target_slot_label,
    'target_action', v_target_action,
    'node_name', v_node_name,
    'actor_slot', v_slot.slot_id
  );
end;
$$;

grant execute on function public.execute_kick(uuid, text) to authenticated;
grant execute on function public.execute_trace(uuid) to authenticated;

notify pgrst, 'reload schema';
