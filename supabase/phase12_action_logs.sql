-- =============================================================================
-- ZERO TRUST — phase12: nomi server dal client + log esito/abort
-- Esegui nell'SQL Editor (dopo phase11).
--
-- - Una sola firma per RPC (niente overload: PostgREST altrimenti ignora
--   p_node_name o non trova la funzione).
-- - Il nome server passato dal client ha priorità sul lookup in nodes.
-- - complete_base_action e abort_action restituiscono `logged`.
-- - write_player_log: insert security definer se l'INSERT client è bloccato.
-- =============================================================================

drop function if exists public.execute_kick(uuid);
drop function if exists public.execute_kick(uuid, text);
drop function if exists public.execute_kick(uuid, text, text);
drop function if exists public.complete_base_action(uuid);
drop function if exists public.complete_base_action(uuid, text);
drop function if exists public.execute_trace(uuid);
drop function if exists public.execute_trace(uuid, text);
drop function if exists public.abort_action(uuid);
drop function if exists public.abort_action(uuid, text);
drop function if exists public.abort_action(uuid, text, text);
drop function if exists public.write_player_log(text, text, text, uuid, uuid, jsonb);
drop function if exists public.zt_node_label(uuid, text);

-- Nome da mostrare nei log: p_fallback (client) prima, poi nodes.name
create or replace function public.zt_node_label(p_node_id uuid, p_fallback text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_db text;
  v_fb text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_fb := nullif(trim(both from coalesce(p_fallback, '')), '');
  if v_fb is not null and lower(v_fb) in ('server', 'server (nome non risolto)') then
    v_fb := null;
  end if;

  if v_fb is not null then
    return v_fb;
  end if;

  select n.name into v_db from public.nodes n where n.id = p_node_id;
  v_db := nullif(trim(both from coalesce(v_db, '')), '');
  if v_db is not null and lower(v_db) <> 'server' then
    return v_db;
  end if;

  return coalesce(v_db, 'Server');
end;
$$;

create or replace function public.write_player_log(
  p_event_type text,
  p_message text,
  p_outcome text default 'info',
  p_node_id uuid default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    p_node_id,
    v_actor,
    p_target_id,
    p_event_type,
    p_message,
    coalesce(nullif(p_outcome, ''), 'info'),
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.abort_action(
  p_actor_slot_id uuid,
  p_node_name text default null,
  p_reason text default 'player_abort'
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
  v_action text;
  v_msg text;
  v_logged boolean := false;
  v_log_err text;
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
    and user_id = v_actor;

  if not found then
    raise exception 'Nessuna operazione attiva da abortire';
  end if;

  v_action := coalesce(v_slot.action_type::text, 'operazione');
  v_node_name := public.zt_node_label(v_slot.node_id, p_node_name);

  v_msg := format(
    'Fallito/Abortito: Operazione di %s interrotta%s — Server: %s [Slot %s]',
    v_action,
    case
      when p_reason = 'tactical_abort' then ' — contromisura sventata'
      else ' manualmente'
    end,
    v_node_name,
    v_slot.slot_id::text
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
      null,
      'abort',
      v_msg,
      'aborted',
      jsonb_build_object(
        'node_name', v_node_name,
        'slot', v_slot.slot_id::text,
        'action_type', v_action,
        'reason', coalesce(p_reason, 'player_abort'),
        'tone', 'warning'
      )
    );
    v_logged := true;
  exception when others then
    v_log_err := SQLERRM;
    raise warning 'abort_action log failed: %', v_log_err;
  end;

  return jsonb_build_object(
    'ok', true,
    'logged', v_logged,
    'node_name', v_node_name,
    'slot', v_slot.slot_id::text,
    'action', v_action,
    'log_error', v_log_err
  );
end;
$$;

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
        'actor_slot', v_slot.slot_id::text,
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
  v_logged boolean := false;
  v_log_err text;
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

  select p.role into v_role from public.profiles p where p.id = v_actor;

  if v_action = 'attack' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before - 10));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Attacco completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  elsif v_action = 'defend' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before + 10));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Difesa completata — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  else
    v_gain := case when v_role = 'executive' then 60 else 30 end;
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
        'slot', v_slot.slot_id::text,
        'ice_before', v_ice_before,
        'ice_after', v_ice_after,
        'gain', v_gain,
        'tone', case when v_action = 'attack' then 'info' else 'success' end
      )
    );
    v_logged := true;
  exception when others then
    v_log_err := SQLERRM;
    raise warning 'complete_base_action log failed: %', v_log_err;
  end;

  return jsonb_build_object(
    'ok', true,
    'logged', v_logged,
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
        'actor_slot', v_slot.slot_id::text,
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
    'actor_slot', v_slot.slot_id::text
  );
end;
$$;

grant execute on function public.zt_node_label(uuid, text) to authenticated;
grant execute on function public.write_player_log(text, text, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.abort_action(uuid, text, text) to authenticated;
grant execute on function public.execute_kick(uuid, text, text) to authenticated;
grant execute on function public.complete_base_action(uuid, text) to authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
