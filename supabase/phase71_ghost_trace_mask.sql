-- =============================================================================
-- ZERO TRUST — phase71: Trace Ghost mask (no name leak)
-- Esegui nell'SQL Editor (dopo phase70).
--
-- Ghost vs non-Analyst: sempre '[ ENCRYPTED ID ]' (niente spoof, niente nome
-- attore/bersaglio). Solo Data Analyst pierce e vede lo username reale.
-- =============================================================================

drop function if exists public.zt_ghost_revealed_name(public.profiles);
drop function if exists public.zt_ghost_revealed_name(public.profiles, uuid);

create or replace function public.zt_ghost_revealed_name(
  p_profile public.profiles,
  p_executor_id uuid default null
)
returns text
language plpgsql
stable
as $$
declare
  v_executor_id uuid;
  v_executor_role public.role_type;
begin
  v_executor_id := coalesce(p_executor_id, auth.uid());

  -- Solo Ghost è mascherato. Tutte le altre classi: username reale.
  if p_profile.role is distinct from 'ghost' then
    return p_profile.name;
  end if;

  if v_executor_id is not null then
    select role into v_executor_role
    from public.profiles
    where id = v_executor_id;
  end if;

  -- Data Analyst: pierce Stealth Protocol (e Identity Spoof)
  if v_executor_role is not distinct from 'analyst' then
    return p_profile.name;
  end if;

  -- Ghost bersaglio + esecutore non Analyst: mai un username reale
  return '[ ENCRYPTED ID ]';
end;
$$;

-- -----------------------------------------------------------------------------
-- execute_trace: mask esplicita sull'attore + stringa log corretta
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
          case when v_revealed in ('[ ENCRYPTED ID ]', 'ENCRYPTED ID', 'ID CRIPTATO')
            then ' — Stealth: [ ENCRYPTED ID ]'
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

revoke execute on function public.zt_ghost_revealed_name(public.profiles, uuid)
  from public, anon, authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
