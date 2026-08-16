-- =============================================================================
-- ZERO TRUST — phase42: Abort bersaglio → Kick/Trace attaccanti annullati
-- Esegui nell'SQL Editor (dopo phase41).
-- Se il target abortisce, ogni Kick/Trace in corso su di lui fallisce subito.
-- =============================================================================

create or replace function public.zt_abort_incoming_hunters(
  p_target_slot_id uuid,
  p_except_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hunter public.slots%rowtype;
  v_hunter_id uuid;
  v_node_name text;
  v_count int := 0;
begin
  if p_target_slot_id is null then
    return 0;
  end if;

  for v_hunter in
    select *
    from public.slots
    where target_slot_id = p_target_slot_id
      and action_type in ('kick', 'trace')
      and user_id is not null
      and user_id is distinct from p_except_user_id
  loop
    v_hunter_id := v_hunter.user_id;
    v_node_name := public.zt_node_label(v_hunter.node_id, null);

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
    where id = v_hunter.id
      and user_id = v_hunter_id;

    update public.profiles
    set status = 'idle'
    where id = v_hunter_id
      and status = 'busy';

    begin
      insert into public.logs (
        node_id, actor_id, target_id, event_type, message, outcome, meta
      ) values (
        v_hunter.node_id,
        v_hunter_id,
        p_except_user_id,
        'abort',
        '[ABORT] Bersaglio perso: la connessione del target è stata interrotta. Operazione annullata.',
        'aborted',
        jsonb_build_object(
          'node_name', v_node_name,
          'slot', v_hunter.slot_id::text,
          'actor_slot', v_hunter.slot_id::text,
          'action_type', v_hunter.action_type::text,
          'reason', 'target_lost',
          'tone', 'warning'
        )
      );
    exception when others then
      raise warning 'zt_abort_incoming_hunters log failed: %', SQLERRM;
    end;

    v_count := v_count + 1;
  end loop;

  return v_count;
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
  v_hunters int := 0;
  v_reason text := coalesce(p_reason, 'player_abort');
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
  for update;

  if not found then
    raise exception 'Nessuna operazione attiva da abortire';
  end if;

  v_action := coalesce(v_slot.action_type::text, 'operazione');
  v_node_name := public.zt_node_label(v_slot.node_id, p_node_name);

  if v_reason = 'target_lost' then
    v_msg := '[ABORT] Bersaglio perso: la connessione del target è stata interrotta. Operazione annullata.';
  else
    v_msg := format(
      'Fallito/Abortito: Operazione di %s interrotta%s — Server: %s [Slot %s]',
      v_action,
      case
        when v_reason = 'tactical_abort' then ' — contromisura sventata'
        else ' manualmente'
      end,
      v_node_name,
      v_slot.slot_id::text
    );
  end if;

  -- Libera lo slot del giocatore che abortisce, poi spezza Kick/Trace in arrivo.
  update public.slots
  set
    user_id = null, action_type = null, start_time = null, end_time = null,
    is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
    spoofed_action = null, target_slot_id = null
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  v_hunters := public.zt_abort_incoming_hunters(v_slot.id, v_actor);

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
        'reason', v_reason,
        'hunters_aborted', v_hunters,
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
    'hunters_aborted', v_hunters,
    'log_error', v_log_err
  );
end;
$$;

grant execute on function public.zt_abort_incoming_hunters(uuid, uuid) to authenticated;
grant execute on function public.abort_action(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
