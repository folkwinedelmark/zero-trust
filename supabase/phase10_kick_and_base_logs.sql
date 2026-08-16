-- =============================================================================
-- ZERO TRUST — phase10: Kick atomico + complete_base_action (log esiti)
-- Esegui nell'SQL Editor. I log NON devono far fallire Kick/risoluzione.
-- =============================================================================

drop function if exists public.execute_kick(uuid);
drop function if exists public.execute_kick(uuid, text);
drop function if exists public.complete_base_action(uuid);

-- ---------------------------------------------------------------------------
-- KICK: espelle, blocca, poi logga (log in EXCEPTION block → no rollback)
-- ---------------------------------------------------------------------------
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
  v_outcome text := 'failure';
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
      select name into v_target_name from public.profiles where id = v_target_id;

      -- A) Svuota lo slot bersaglio
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

      -- B) Qualsiasi altro slot del target
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

      -- C) Block + IDLE
      update public.profiles
      set is_blocked = true, status = 'idle'
      where id = v_target_id;

      v_outcome := 'success';
    end if;
  end if;

  v_display_name := coalesce(
    nullif(trim(both from coalesce(v_target_name, '')), ''),
    nullif(trim(both from coalesce(p_known_handle, '')), ''),
    'Unknown'
  );

  -- D) Libera sempre lo slot del kicker + IDLE (anche se kick fallito)
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
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  -- E) Log (non deve mai invalidare A–D)
  begin
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
        'actor_slot', v_slot.slot_id,
        'target_slot', v_target_slot_label,
        'compromised_slot', v_target_slot_label,
        'compromised_action', v_target_action,
        'target_action', v_target_action,
        'display_name', v_display_name,
        'tone', case when v_outcome = 'success' then 'info' else 'danger' end
      )
    );

    if v_outcome = 'success' and v_target_id is not null then
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
    'blocked', (v_outcome = 'success'),
    'outcome', v_outcome,
    'target_id', v_target_id,
    'target_name', v_display_name,
    'node_name', v_node_name,
    'target_slot', v_target_slot_label
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- BASE ACTIONS: effetti + log successo + clear slot (server-side)
-- ---------------------------------------------------------------------------
create or replace function public.complete_base_action(p_actor_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_node public.nodes%rowtype;
  v_profile public.profiles%rowtype;
  v_ice_before int;
  v_ice_after int;
  v_gain int := 0;
  v_detail text;
  v_msg text;
begin
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

  select * into v_node from public.nodes where id = v_slot.node_id;
  select * into v_profile from public.profiles where id = v_actor;

  if v_slot.action_type = 'attack' then
    v_ice_before := coalesce(v_node.ice, 0);
    v_ice_after := greatest(0, least(100, v_ice_before - 10));
    update public.nodes set ice = v_ice_after where id = v_node.id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Attacco completato — %s — Server: %s [Slot %s]',
      v_detail, coalesce(v_node.name, 'Server'), v_slot.slot_id
    );
  elsif v_slot.action_type = 'defend' then
    v_ice_before := coalesce(v_node.ice, 0);
    v_ice_after := greatest(0, least(100, v_ice_before + 10));
    update public.nodes set ice = v_ice_after where id = v_node.id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Difesa completata — %s — Server: %s [Slot %s]',
      v_detail, coalesce(v_node.name, 'Server'), v_slot.slot_id
    );
  else
    -- farm
    v_gain := case when v_profile.role = 'executive' then 60 else 30 end;
    update public.profiles set creds = creds + v_gain where id = v_actor;
    v_detail := format('+%s ₵', v_gain);
    v_msg := format(
      'Successo: Farming completato — %s — Server: %s [Slot %s]',
      v_detail, coalesce(v_node.name, 'Server'), v_slot.slot_id
    );
  end if;

  -- Clear slot + IDLE
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
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      null,
      v_slot.action_type::text,
      v_msg,
      'success',
      jsonb_build_object(
        'node_name', v_node.name,
        'slot', v_slot.slot_id,
        'ice_before', v_ice_before,
        'ice_after', v_ice_after,
        'gain', v_gain,
        'tone', case when v_slot.action_type = 'attack' then 'info' else 'success' end
      )
    );
  exception when others then
    raise warning 'complete_base_action log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'action', v_slot.action_type,
    'detail', v_detail,
    'node_name', v_node.name,
    'slot', v_slot.slot_id
  );
end;
$$;

grant execute on function public.execute_kick(uuid, text) to authenticated;
grant execute on function public.complete_base_action(uuid) to authenticated;

notify pgrst, 'reload schema';
