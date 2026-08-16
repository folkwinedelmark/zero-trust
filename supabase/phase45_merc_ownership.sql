-- =============================================================================
-- ZERO TRUST — phase45: Mercenary server ownership + daily rendita
-- Esegui nell'SQL Editor (dopo phase44).
--
-- Extract Mercenary: owner_faction = 'consultant' (non Neutral) + Core Data.
-- Daily tick: ogni server Merc paga +100 ₵ a tutti i profili consultant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extract: Mercenary prende il server (consultant), non lo azzera a Neutral
-- -----------------------------------------------------------------------------
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
  v_hw text;
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

  select p.role, p.equipped_hardware, p.faction
  into v_role, v_hw, v_faction
  from public.profiles p where p.id = v_actor;

  v_ice_delta := case
    when v_hw = 'heuristic' then 12
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
    v_gain := case when v_role = 'executive' then 60 else 30 end;
    if v_hw = 'ram' then
      v_gain := round(v_gain * 1.2);
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
          'hardware', v_hw,
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

-- -----------------------------------------------------------------------------
-- Daily tick: rendita Mercenary (+100 ₵ × server consultant, a tutti i Merc)
-- -----------------------------------------------------------------------------
create or replace function public.simulate_daily_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corp int := 0;
  v_rebel int := 0;
  v_merc_nodes int := 0;
  v_merc_payout int := 0;
  v_merc_paid int := 0;
  v_corp_score int := 0;
  v_rebel_score int := 0;
  v_refreshed int := 0;
  v_unblocked int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  select count(*)::int into v_corp
  from public.nodes
  where type = 'server' and owner_faction = 'security';

  select count(*)::int into v_rebel
  from public.nodes
  where type = 'server' and owner_faction = 'hacktivist';

  select count(*)::int into v_merc_nodes
  from public.nodes
  where type = 'server' and owner_faction = 'consultant';

  v_corp_score := public.zt_add_faction_score('security', v_corp);
  v_rebel_score := public.zt_add_faction_score('hacktivist', v_rebel);

  v_merc_payout := v_merc_nodes * 100;
  if v_merc_payout > 0 then
    update public.profiles
    set creds = creds + v_merc_payout
    where faction = 'consultant';
    get diagnostics v_merc_paid = row_count;
  end if;

  update public.profiles
  set
    pa = public.zt_pa_max(),
    pa_refreshed_at = timezone('utc', now())
  where pa < public.zt_pa_max();
  get diagnostics v_refreshed = row_count;

  update public.profiles
  set heat = heat - 1
  where heat > 0;

  update public.profiles
  set is_blocked = false
  where is_blocked = true;
  get diagnostics v_unblocked = row_count;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      null,
      null,
      'daily_tick',
      format(
        '[SYSTEM] Ciclo di 24 ore completato. Punti Vittoria assegnati, PA ripristinati, Heat −1, account sbloccati.%s',
        case
          when v_merc_payout > 0 then
            format(' Rendita Mercenary: %s server × 100 ₵ (%s agenti pagati).', v_merc_nodes, v_merc_paid)
          else ''
        end
      ),
      'info',
      jsonb_build_object(
        'tone', 'info',
        'corp_servers', v_corp,
        'rebel_servers', v_rebel,
        'merc_servers', v_merc_nodes,
        'merc_payout', v_merc_payout,
        'merc_paid', v_merc_paid,
        'corp_score', v_corp_score,
        'rebel_score', v_rebel_score,
        'profiles_unblocked', v_unblocked
      ),
      true
    );
  exception when others then
    raise warning 'simulate_daily_tick log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'corp_servers', v_corp,
    'rebel_servers', v_rebel,
    'merc_servers', v_merc_nodes,
    'merc_payout', v_merc_payout,
    'merc_paid', v_merc_paid,
    'corp_score', v_corp_score,
    'rebel_score', v_rebel_score,
    'profiles_refreshed', v_refreshed,
    'profiles_unblocked', v_unblocked
  );
end;
$$;

grant execute on function public.simulate_daily_tick() to authenticated;

notify pgrst, 'reload schema';
