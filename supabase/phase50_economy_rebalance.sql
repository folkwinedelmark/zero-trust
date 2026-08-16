-- =============================================================================
-- ZERO TRUST — phase50: farm 50 ₵, Exec ×1.75, RAM ×1.3, Heuristic ICE ±15
-- Esegui nell'SQL Editor (dopo phase49).
-- =============================================================================

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
  v_faction public.faction_type;
  v_hw text[];
  v_ice_delta int;
  v_ice_before int;
  v_ice_after int;
  v_gain int := 0;
  v_detail text;
  v_msg text;
  v_action text;
  v_logged boolean := false;
  v_log_err text;
  v_stealthed boolean := false;
  v_outcome text := 'success';
  v_owner public.faction_type;
  v_core_data boolean := false;
  v_faction_label text;
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
    and action_type in ('attack', 'defend', 'farm', 'extract');

  if not found then
    raise exception 'Azione base non valida o già completata';
  end if;

  v_node_id := v_slot.node_id;
  v_action := v_slot.action_type::text;
  v_node_name := public.zt_node_label(v_node_id, p_node_name);
  v_stealthed := public.zt_is_stealthed(v_actor);

  select p.role, coalesce(p.equipped_hardware, '{}'::text[]), p.faction
  into v_role, v_hw, v_faction
  from public.profiles p where p.id = v_actor;

  v_ice_delta := case
    when v_hw @> array['heuristic']::text[] then 15
    else 10
  end;

  if v_action = 'attack' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before - v_ice_delta));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Attacco completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  elsif v_action = 'defend' then
    select coalesce(n.ice, 0) into v_ice_before from public.nodes n where n.id = v_node_id;
    v_ice_after := greatest(0, least(100, v_ice_before + v_ice_delta));
    update public.nodes set ice = v_ice_after where id = v_node_id;
    v_detail := format('ICE %s%% → %s%%', v_ice_before, v_ice_after);
    v_msg := format(
      'Successo: Difesa completata — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  elsif v_action = 'farm' then
    v_gain := 50;
    if v_role = 'executive' then
      v_gain := round(v_gain * 1.75);
    end if;
    if v_hw @> array['ram']::text[] then
      v_gain := round(v_gain * 1.3);
    end if;
    update public.profiles set creds = creds + v_gain where id = v_actor;
    v_detail := format('+%s ₵', v_gain);
    v_msg := format(
      'Successo: Farming completato — %s — Server: %s [Slot %s]',
      v_detail, v_node_name, v_slot.slot_id::text
    );
  else
    select coalesce(n.ice, 0), n.owner_faction
    into v_ice_before, v_owner
    from public.nodes n
    where n.id = v_node_id
    for update;

    if v_ice_before > 20 then
      v_ice_after := v_ice_before;
      v_outcome := 'failure';
      v_detail := format('ICE %s%% > 20%% — estrazione fallita', v_ice_before);
      v_msg := format(
        'Fallito: Extract — %s — Server: %s [Slot %s]',
        v_detail, v_node_name, v_slot.slot_id::text
      );
    elsif v_owner is not null and v_owner = v_faction then
      v_ice_after := v_ice_before;
      v_outcome := 'failure';
      v_detail := 'server già sotto il controllo della tua fazione';
      v_msg := format(
        'Fallito: Extract — %s — Server: %s [Slot %s]',
        v_detail, v_node_name, v_slot.slot_id::text
      );
    elsif v_faction in ('security', 'hacktivist') then
      v_ice_after := 100;
      v_owner := v_faction;
      v_faction_label := case v_faction
        when 'security' then 'Corp'
        when 'hacktivist' then 'Rebel'
        else v_faction::text
      end;
      update public.nodes
      set ice = 100, owner_faction = v_faction, compromised = false
      where id = v_node_id;
      v_detail := format('Controllo %s · ICE 100%%', v_faction_label);
      v_msg := format(
        'Estrazione completata. Il server %s è stato riavviato e ora è sotto il controllo della fazione %s.',
        v_node_name,
        v_faction_label
      );
    else
      v_ice_after := 100;
      v_owner := 'consultant';
      v_core_data := true;
      update public.nodes
      set ice = 100, owner_faction = 'consultant', compromised = false
      where id = v_node_id;
      perform public.zt_grant_item(v_actor, 'core_data');
      v_detail := '+1 Core Data · Controllo Mercenary · ICE 100%';
      v_msg := format(
        'Estrazione completata. Il server %s è stato riavviato e ora è sotto il controllo della fazione Mercenary. +1 Core Data.',
        v_node_name
      );
    end if;
  end if;

  update public.slots
  set
    user_id = null, action_type = null, start_time = null, end_time = null,
    is_decoy = false, is_spoofed = false, spoofed_as_user_id = null,
    spoofed_action = null, target_slot_id = null
  where id = v_slot.id;

  update public.profiles set status = 'idle' where id = v_actor;

  if not v_stealthed then
    begin
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_node_id, v_actor, null, v_action, v_msg, v_outcome,
        jsonb_build_object(
          'node_name', v_node_name,
          'slot', v_slot.slot_id::text,
          'ice_before', v_ice_before,
          'ice_after', v_ice_after,
          'gain', v_gain,
          'hardware', to_jsonb(v_hw),
          'owner_faction', v_owner,
          'core_data', v_core_data,
          'tone', case
            when v_outcome = 'failure' then 'danger'
            when v_action = 'attack' then 'info'
            when v_action = 'extract' then 'success'
            else 'success'
          end
        )
      );
      v_logged := true;
    exception when others then
      v_log_err := SQLERRM;
      raise warning 'complete_base_action log failed: %', v_log_err;
    end;
  end if;

  return jsonb_build_object(
    'ok', v_outcome = 'success',
    'logged', v_logged,
    'stealthed', v_stealthed,
    'action', v_action,
    'outcome', v_outcome,
    'detail', v_detail,
    'node_name', v_node_name,
    'slot', v_slot.slot_id::text,
    'ice_before', v_ice_before,
    'ice_after', v_ice_after,
    'gain', v_gain,
    'owner_faction', v_owner,
    'core_data', v_core_data,
    'log_error', v_log_err
  );
end;
$$;

grant execute on function public.complete_base_action(uuid, text) to authenticated;

notify pgrst, 'reload schema';
