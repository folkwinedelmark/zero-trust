-- =============================================================================
-- ZERO TRUST — phase16: identità Kick legata all'intel Trace della sessione
-- Esegui nell'SQL Editor (dopo phase15).
--
-- Scenario A — Trace riuscito sulla occupancy corrente:
--   i log Kick dell'attore mostrano l'handle rivelato dal Trace
--   (o ID CRIPTATO se Ghost).
-- Scenario B — Kick alla cieca (nessun Trace):
--   il log dell'attore resta sempre "Unknown". Lo sgombero NON smaschera
--   il nome: fog of war. kick_received (solo vittima) può citare l'azione.
-- =============================================================================

drop function if exists public.zt_lookup_kick_intel(uuid, uuid, uuid, timestamptz, timestamptz);

-- Consume inventario: definito in phase19/phase21.
-- Non creare uno stub qui: un CREATE OR REPLACE a false spezzerebbe Bailout/Jammer.

create or replace function public.zt_lookup_kick_intel(
  p_actor_id uuid,
  p_target_slot_id uuid,
  p_target_id uuid,
  p_session_start timestamptz,
  p_kick_started timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_handle text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if p_actor_id is null then
    return null;
  end if;

  -- Sessione attiva: occupancy del bersaglio. Se è già fuggito, finestra dal Kick.
  v_since := coalesce(
    p_session_start,
    p_kick_started - interval '1 hour',
    timezone('utc', now()) - interval '1 hour'
  );

  select nullif(trim(both from coalesce(l.meta->>'revealed', '')), '')
  into v_handle
  from public.logs l
  where l.actor_id = p_actor_id
    and l.event_type = 'trace'
    and coalesce(l.outcome, l.meta->>'outcome', 'success') = 'success'
    and l.created_at >= v_since
    and coalesce(nullif(trim(both from coalesce(l.meta->>'revealed', '')), ''), 'Unknown')
        not in ('Unknown', 'Segnale perso')
    and (
      -- Stesso bersaglio (occupante attuale o snapshot a inizio Kick)
      (
        p_target_id is not null
        and l.target_id = p_target_id
      )
      -- Decoy / nessun user noto: solo Trace su quello slot senza altro occupante
      or (
        p_target_id is null
        and p_target_slot_id is not null
        and l.meta->>'target_slot_id' = p_target_slot_id::text
        and l.target_id is null
      )
    )
  order by l.created_at desc
  limit 1;

  return v_handle;
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

      if public.zt_consume_item(v_target_id, 'bailout') then
        update public.profiles set status = 'idle' where id = v_target_id;
      else
        update public.profiles
        set is_blocked = true, status = 'idle'
        where id = v_target_id;
      end if;

      v_outcome := 'success';
    end if;
  end if;

  -- Chi stavamo kickando: occupante attuale, oppure snapshot da kick_incoming
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

  -- Intel server-side: Trace riuscito sulla sessione attiva. Non fidarsi del client.
  v_intel_handle := public.zt_lookup_kick_intel(
    v_actor,
    v_slot.target_slot_id,
    v_aimed_id,
    v_session_start,
    v_slot.start_time
  );
  v_has_intel := v_intel_handle is not null;

  -- Hint client accettato solo se conferma un intel già verificato
  if not v_has_intel then
    p_known_handle := null;
  elsif coalesce(nullif(trim(both from coalesce(p_known_handle, '')), ''), '') = '' then
    p_known_handle := v_intel_handle;
  end if;

  -- Fog of war: il nome reale NON entra mai nel log attore senza Trace.
  -- Nemmeno a Kick riuscito: lo sgombero non è un Trace.
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
        when v_outcome = 'success' then
          format(
            'Successo: Kick eseguito con successo su %s — account BLOCKED — Server: %s [Slot %s]',
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
        'target_slot_id', v_slot.target_slot_id,
        'compromised_slot', v_target_slot_label,
        'compromised_action', case when v_has_intel then v_target_action else null end,
        'target_action', case when v_has_intel then v_target_action else null end,
        'display_name', v_display_name,
        'intel_handle', v_intel_handle,
        'has_intel', v_has_intel,
        'unmasked', false,
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

grant execute on function public.zt_lookup_kick_intel(uuid, uuid, uuid, timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.execute_kick(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
