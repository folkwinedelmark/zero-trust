-- =============================================================================
-- ZERO TRUST — phase11: nomi server reali + handle Kick dopo Trace
-- Esegui nell'SQL Editor (dopo phase10).
-- =============================================================================

drop function if exists public.execute_kick(uuid);
drop function if exists public.execute_kick(uuid, text);
drop function if exists public.complete_base_action(uuid);

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
  v_target_id uuid;
  v_target_name text;
  v_display_name text;
  v_node_name text;
  v_target_action text;
  v_target_slot_label text;
  v_outcome text := 'failure';
begin
  -- Bypass RLS: altrimenti name di nodes/profiles può tornare NULL → "Server"/"Unknown"
  perform set_config('row_security', 'off', true);

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

  select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
  v_node_name := coalesce(
    nullif(trim(both from coalesce(v_node_name, '')), ''),
    nullif(trim(both from coalesce(p_node_name, '')), ''),
    'Server'
  );

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
      select p.name into v_target_name from public.profiles p where p.id = v_target_id;

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
      set is_blocked = true, status = 'idle'
      where id = v_target_id;

      v_outcome := 'success';
    end if;
  end if;

  -- Preferisci intel Trace (p_known_handle), poi nome profilo; Ghost resta "ID CRIPTATO" se tracciato
  v_display_name := coalesce(
    nullif(trim(both from coalesce(p_known_handle, '')), ''),
    nullif(trim(both from coalesce(v_target_name, '')), ''),
    'Unknown'
  );

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
        'known_handle', p_known_handle,
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
  v_ice_before int;
  v_ice_after int;
  v_gain int := 0;
  v_detail text;
  v_msg text;
  v_action text;
begin
  perform set_config('row_security', 'off', true);

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

  select n.name into v_node_name from public.nodes n where n.id = v_node_id;
  v_node_name := coalesce(
    nullif(trim(both from coalesce(v_node_name, '')), ''),
    nullif(trim(both from coalesce(p_node_name, '')), ''),
    'Server'
  );

  select p.role into v_role from public.profiles p where p.id = v_actor;

  if v_action = 'attack' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before - 10));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Attacco completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id
    );
  elsif v_action = 'defend' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before + 10));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Difesa completata — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id
    );
  else
    v_gain := case when v_role = 'executive' then 60 else 30 end;
    update public.profiles set creds = creds + v_gain where id = v_actor;
    v_detail := format('+%s ₵', v_gain);
    v_msg := format(
      'Successo: Farming completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id
    );
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
      v_node_id,
      v_actor,
      null,
      v_action,
      v_msg,
      'success',
      jsonb_build_object(
        'node_name', v_node_name,
        'slot', v_slot.slot_id,
        'ice_before', v_ice_before,
        'ice_after', v_ice_after,
        'gain', v_gain,
        'tone', case when v_action = 'attack' then 'info' else 'success' end
      )
    );
  exception when others then
    raise warning 'complete_base_action log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'detail', v_detail,
    'node_name', v_node_name,
    'slot', v_slot.slot_id
  );
end;
$$;

-- Trace: stessi fix nome server + row_security off
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
  v_target_slot_label text;
  v_outcome text := 'success';
begin
  perform set_config('row_security', 'off', true);

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

  select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
  v_node_name := coalesce(
    nullif(trim(both from coalesce(v_node_name, '')), ''),
    nullif(trim(both from coalesce(p_node_name, '')), ''),
    'Server'
  );

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

  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      v_slot.node_id,
      v_actor,
      v_target_id,
      'trace',
      case
        when v_outcome = 'failure' then
          format('Fallito: Trace (segnale perso) — Server: %s [Slot %s]', v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text))
        else
          format('Successo: Trace completato su %s — Server: %s [Slot %s]', v_revealed, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text))
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
        format(
          'Subito Trace%s — Server: %s [Slot %s]%s',
          case when v_target_action is not null then format(' mentre eseguivi %s', v_target_action) else '' end,
          v_node_name,
          coalesce(v_target_slot_label, '?'),
          case when v_revealed = 'ID CRIPTATO' then ' — Stealth: ID CRIPTATO' else ' — identità esposta' end
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
    'target_slot_id', v_slot.target_slot_id,
    'target_slot', v_target_slot_label,
    'target_action', v_target_action,
    'node_name', v_node_name,
    'actor_slot', v_slot.slot_id
  );
end;
$$;

grant execute on function public.execute_kick(uuid, text, text) to authenticated;
grant execute on function public.complete_base_action(uuid, text) to authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

-- Compat: overload a 1–2 argomenti che inoltrano ai nuovi
create or replace function public.execute_kick(p_actor_slot_id uuid, p_known_handle text default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_kick(p_actor_slot_id, p_known_handle, null::text);
$$;

create or replace function public.complete_base_action(p_actor_slot_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.complete_base_action(p_actor_slot_id, null::text);
$$;

create or replace function public.execute_trace(p_actor_slot_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.execute_trace(p_actor_slot_id, null::text);
$$;

grant execute on function public.execute_kick(uuid, text) to authenticated;
grant execute on function public.complete_base_action(uuid) to authenticated;
grant execute on function public.execute_trace(uuid) to authenticated;

notify pgrst, 'reload schema';
