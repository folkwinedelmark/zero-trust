-- ZERO TRUST — phase22: Heat su Trace (+1) e Kick (+2), cap 5.
-- Wipe Record (Helpdesk) continua ad azzerare heat.
-- Esegui questo file sull'SQL Editor (idempotente).

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
  v_target_found boolean := false;
  v_target_id uuid;
  v_target_name text;
  v_intel_handle text;
  v_has_intel boolean := false;
  v_display_name text;
  v_node_name text;
  v_target_action text;
  v_target_slot_label text;
  v_session_start timestamptz;
  v_aimed_id uuid;
  v_outcome text := 'failure';
  v_bailed boolean := false;
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
    raise exception 'Kick non valido o giÃ  completato';
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor;
  v_node_name := public.zt_node_label(v_slot.node_id, p_node_name);

  v_target_id := null;
  v_target_name := null;
  v_target_action := null;
  v_target_slot_label := null;
  v_session_start := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;
    v_target_found := found;

    if v_target_found then
      v_target_slot_label := v_target.slot_id::text;
      v_target_action := v_target.action_type::text;
      v_session_start := v_target.start_time;
    end if;

    if v_target_found and v_target.user_id is not null then
      v_target_id := v_target.user_id;
      select p.name into v_target_name from public.profiles p where p.id = v_target_id;

      -- Bailout prima dello sgombero: se c'Ã¨ il token, il kick fallisce e il
      -- bersaglio resta sullo slot, busy, non bloccato. Il token si consuma.
      if public.zt_consume_item(v_target_id, 'bailout') then
        v_bailed := true;
        v_outcome := 'failure';
      else
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
        set is_blocked = true, status = 'idle',
            heat = least(5, coalesce(heat, 0) + 2)
        where id = v_target_id;

        v_outcome := 'success';
      end if;
    end if;
  end if;

  v_aimed_id := v_target_id;
  if v_aimed_id is null then
    select l.target_id
    into v_aimed_id
    from public.logs l
    where l.actor_id = v_actor
      and l.event_type = 'kick_incoming'
      and l.target_id is not null
      and l.created_at >= v_slot.start_time - interval '15 seconds'
      and l.created_at <= timezone('utc', now()) + interval '5 seconds'
      and (l.node_id is null or l.node_id = v_slot.node_id)
    order by l.created_at desc
    limit 1;
  end if;

  v_intel_handle := public.zt_lookup_kick_intel(
    v_actor,
    v_slot.target_slot_id,
    v_aimed_id,
    v_session_start,
    v_slot.start_time
  );
  v_has_intel := v_intel_handle is not null;

  if not v_has_intel then
    p_known_handle := null;
  elsif coalesce(nullif(trim(both from coalesce(p_known_handle, '')), ''), '') = '' then
    p_known_handle := v_intel_handle;
  end if;

  if v_has_intel then
    v_display_name := coalesce(v_intel_handle, 'Unknown');
  else
    v_display_name := 'Unknown';
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
      v_slot.node_id,
      v_actor,
      case when v_has_intel then v_target_id else null end,
      'kick',
      case
        when v_bailed then
          format(
            'Fallito: Kick vanificato su %s â€” Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. â€” Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_outcome = 'success' then
          format(
            'Successo: Kick eseguito con successo su %s â€” account BLOCKED â€” Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        else
          format(
            'Fallito: Kick vanificato su %s â€” Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
      end,
      v_outcome,
      jsonb_build_object(
        'node_name', v_node_name,
        'actor_slot', v_slot.slot_id::text,
        'target_slot', v_target_slot_label,
        'target_slot_id', v_slot.target_slot_id,
        'compromised_slot', v_target_slot_label,
        'compromised_action', case when v_has_intel then v_target_action else null end,
        'target_action', case when v_has_intel then v_target_action else null end,
        'display_name', v_display_name,
        'intel_handle', v_intel_handle,
        'has_intel', v_has_intel,
        'unmasked', false,
        'known_handle', p_known_handle,
        'bailed', v_bailed,
        'tone', case
          when v_bailed then 'warning'
          when v_outcome = 'success' then 'info'
          else 'danger'
        end
      )
    );

    if v_bailed and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_target_id,
        v_actor,
        'bailout_consumed',
        format(
          'Bailout Token consumato automaticamente: Kick e blocco account evitati su %s. â€” Server: %s',
          v_node_name, v_node_name
        ),
        'success',
        jsonb_build_object(
          'node_name', v_node_name,
          'compromised_slot', v_target_slot_label,
          'tone', 'success',
          'item_id', 'bailout'
        )
      );

      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        case when v_has_intel then v_target_id else null end,
        'bailout_averted',
        format(
          'Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. â€” Server: %s [Slot %s]',
          v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
        ),
        'failure',
        jsonb_build_object(
          'node_name', v_node_name,
          'target_slot', v_target_slot_label,
          'tone', 'warning',
          'has_intel', v_has_intel,
          'bailed', true
        )
      );
    elsif v_outcome = 'success' and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        v_target_id,
        'kick_received',
        format(
          'Kick subito da %s%s â€” account BLOCKED â€” Server: %s [Slot %s]',
          coalesce(v_actor_name, 'agente'),
          case when v_target_action is not null
            then format(' â€” operazione di %s interrotta', v_target_action)
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
    'blocked', (v_outcome = 'success' and not v_bailed),
    'bailed', v_bailed,
    'outcome', v_outcome,
    'target_id', case when v_has_intel then v_target_id else null end,
    'target_name', v_display_name,
    'has_intel', v_has_intel,
    'intel_handle', v_intel_handle,
    'unmasked', false,
    'node_name', v_node_name,
    'target_slot', v_target_slot_label
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Trace: Jammer passivo avvisa anche il difensore
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
    raise exception 'Trace non valido o giÃ  completato';
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
            'Fallito: Bersaglio digitalmente non tracciabile. â€” Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_jammed then
          format(
            'Fallito: Trace fallito: rilevata interferenza di rete. â€” Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_outcome = 'failure' then
          format(
            'Fallito: Trace (segnale perso) â€” Server: %s [Slot %s]',
            v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_action_label is not null then
          format(
            'Successo: Trace completato su %s â€” azione: %s â€” Server: %s [Slot %s]',
            v_revealed, v_action_label, v_node_name,
            coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        else
          format(
            'Successo: Trace completato su %s â€” Server: %s [Slot %s]',
            v_revealed, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
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
          'Signal Jammer consumato automaticamente: Trace in arrivo bloccato su %s. â€” Server: %s',
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
          'Subito Trace%s â€” Server: %s [Slot %s]%s',
          case when v_action_label is not null
            then format(' mentre eseguivi %s', v_action_label)
            else '' end,
          v_node_name,
          coalesce(v_target_slot_label, '?'),
          case when v_revealed = 'ID CRIPTATO'
            then ' â€” Stealth: ID CRIPTATO'
            else ' â€” identitÃ  esposta' end
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

grant execute on function public.execute_kick(uuid, text, text) to authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
