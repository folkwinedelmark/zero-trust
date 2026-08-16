-- =============================================================================
-- ZERO TRUST — phase43: Executive Scudo Legale (Immunity rework)
-- Esegui nell'SQL Editor (dopo phase42).
-- Immunity è un buff preparatorio: protegge la prossima Attack/Defend/Farm.
-- =============================================================================

alter table public.profiles
  add column if not exists has_legal_shield boolean not null default false;

alter table public.slots
  add column if not exists is_immune boolean not null default false;

-- -----------------------------------------------------------------------------
-- Kick immunity: slot protetto (is_immune) + legacy kick_immune_until
-- -----------------------------------------------------------------------------
create or replace function public.zt_is_kick_immune(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.slots s
    where s.user_id = p_user_id
      and s.is_immune
      and s.action_type in ('attack', 'defend', 'farm')
  )
  or exists (
    select 1
    from public.profiles p
    join public.slots s on s.user_id = p.id
    where p.id = p_user_id
      and p.kick_immune_until is not null
      and p.kick_immune_until > timezone('utc', now())
      and s.action_type in ('attack', 'defend', 'farm', 'extract')
  );
$$;

create or replace function public.zt_clear_slot_row(p_slot_id uuid)
returns void
language plpgsql
as $$
begin
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
    target_slot_id = null,
    is_immune = false
  where id = p_slot_id;
end;
$$;

create or replace function public.zt_resolve_kick_target(
  p_target_id uuid,
  p_target_slot_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_slot_id is not null then
    if exists (
      select 1 from public.slots
      where id = p_target_slot_id
        and is_decoy
        and user_id is null
    ) then
      perform public.zt_clear_slot_row(p_target_slot_id);
      return 'decoy';
    end if;

    if exists (
      select 1 from public.slots
      where id = p_target_slot_id
        and is_immune
        and action_type in ('attack', 'defend', 'farm')
    ) then
      return 'immune';
    end if;
  end if;

  if p_target_id is null then
    return 'empty';
  end if;

  if public.zt_is_kick_immune(p_target_id) then
    return 'immune';
  end if;

  if public.zt_consume_item(p_target_id, 'bailout') then
    return 'bailed';
  end if;

  if p_target_slot_id is not null then
    perform public.zt_clear_slot_row(p_target_slot_id);
  end if;

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
    target_slot_id = null,
    is_immune = false
  where user_id = p_target_id;

  update public.profiles
  set
    is_blocked = true,
    status = 'idle',
    heat = least(5, coalesce(heat, 0) + 2)
  where id = p_target_id;

  return 'kicked';
end;
$$;

-- -----------------------------------------------------------------------------
-- Immunity: buff globale, senza azione in corso
-- -----------------------------------------------------------------------------
create or replace function public.zt_activate_legal_shield()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_profile := public.zt_spend_ability('immunity', v_actor);

  update public.profiles
  set has_legal_shield = true
  where id = v_actor;

  perform public.zt_log_ability(
    v_actor,
    'immunity',
    '[ABILITÀ] Scudo Legale attivato: la prossima operazione base sarà protetta.',
    null,
    null,
    jsonb_build_object('has_legal_shield', true)
  );

  return jsonb_build_object(
    'ok', true,
    'ability_id', 'immunity',
    'result', jsonb_build_object('has_legal_shield', true)
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.use_ability_legacy(text, uuid, uuid, uuid, integer)') is null
     and to_regprocedure('public.use_ability(text, uuid, uuid, uuid, integer)') is not null then
    alter function public.use_ability(text, uuid, uuid, uuid, integer)
      rename to use_ability_legacy;
  end if;
end $$;

create or replace function public.use_ability(
  p_ability_id text,
  p_target_id uuid default null,
  p_target_slot_id uuid default null,
  p_node_id uuid default null,
  p_ice_sign integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ability_id = 'immunity' then
    return public.zt_activate_legal_shield();
  end if;
  return public.use_ability_legacy(
    p_ability_id,
    p_target_id,
    p_target_slot_id,
    p_node_id,
    p_ice_sign
  );
end;
$$;

grant execute on function public.zt_activate_legal_shield() to authenticated;
grant execute on function public.use_ability(text, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.use_ability_legacy(text, uuid, uuid, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- start_action: consuma Scudo Legale su Attack/Defend/Farm (mai Extract)
-- -----------------------------------------------------------------------------
create or replace function public.start_action(
  p_slot_id uuid,
  p_action_type public.action_type,
  p_start timestamptz,
  p_end timestamptz,
  p_target_slot_id uuid default null,
  p_node_id uuid default null,
  p_base_pa integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_slot public.slots%rowtype;
  v_node public.nodes%rowtype;
  v_cost int;
  v_claimed public.slots%rowtype;
  v_apply_shield boolean := false;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_daytime();

  select * into v_profile
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;
  if v_profile.is_blocked then
    raise exception 'Account BLOCKED';
  end if;
  if v_profile.status is distinct from 'idle' then
    raise exception 'Impossibile passare a BUSY.';
  end if;

  select * into v_slot
  from public.slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Slot non trovato';
  end if;
  if v_slot.user_id is not null or v_slot.is_decoy then
    return jsonb_build_object('collided', true);
  end if;
  if v_slot.locked_until is not null and v_slot.locked_until > timezone('utc', now()) then
    raise exception 'Slot locked';
  end if;
  if v_slot.is_backdoor and v_profile.role is distinct from 'ghost' then
    raise exception 'Solo i Ghost possono usare Slot D';
  end if;

  if p_node_id is not null and v_slot.node_id is distinct from p_node_id then
    raise exception 'Slot non appartiene a questo server';
  end if;

  select * into v_node from public.nodes where id = v_slot.node_id;
  if not found or v_node.type is distinct from 'server' then
    raise exception 'Server non valido';
  end if;

  if p_action_type = 'extract' then
    if coalesce(v_node.ice, 0) > 20 then
      raise exception 'Extract disponibile solo con ICE ≤ 20%%.';
    end if;
    if v_node.owner_faction is not null
       and v_profile.faction is not null
       and v_node.owner_faction = v_profile.faction then
      raise exception 'Non puoi estrarre un server già sotto il controllo della tua fazione.';
    end if;
  end if;

  if coalesce(p_base_pa, 1) <= 0 then
    v_cost := 0;
  else
    v_cost := 1;
    if v_slot.is_backdoor then
      v_cost := v_cost + 1;
    end if;
  end if;

  if v_profile.pa < v_cost then
    raise exception 'PA insufficienti (servono % PA)', v_cost;
  end if;

  v_apply_shield :=
    coalesce(v_profile.has_legal_shield, false)
    and p_action_type in ('attack', 'defend', 'farm');

  update public.slots
  set
    user_id = v_actor,
    action_type = p_action_type,
    start_time = p_start,
    end_time = p_end,
    is_decoy = false,
    is_spoofed = false,
    spoofed_as_user_id = null,
    spoofed_action = null,
    target_slot_id = p_target_slot_id,
    is_immune = v_apply_shield
  where id = v_slot.id
    and user_id is null
    and not is_decoy
  returning * into v_claimed;

  if not found then
    return jsonb_build_object('collided', true);
  end if;

  update public.profiles
  set
    status = 'busy',
    pa = pa - v_cost,
    current_node_id = v_slot.node_id,
    has_legal_shield = case
      when v_apply_shield then false
      else has_legal_shield
    end
  where id = v_actor
    and status = 'idle'
    and is_blocked = false;

  if not found then
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
      target_slot_id = null,
      is_immune = false
    where id = v_slot.id
      and user_id = v_actor;
    raise exception 'Impossibile passare a BUSY.';
  end if;

  return jsonb_build_object(
    'collided', false,
    'claimed', to_jsonb(v_claimed),
    'pa_cost', v_cost,
    'legal_shield_applied', v_apply_shield
  );
end;
$$;

grant execute on function public.start_action(
  uuid, public.action_type, timestamptz, timestamptz, uuid, uuid, integer
) to authenticated;

-- Pulizia is_immune sugli abort cacciatori
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
    perform public.zt_clear_slot_row(v_hunter.id);

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

-- Reset: pulisce scudo e flag slot
create or replace function public.reset_total()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_logs int := 0;
  v_gigs int := 0;
  v_auctions int := 0;
  v_nodes int := 0;
  v_slots int := 0;
  v_profiles int := 0;
  v_notes int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  if to_regclass('public.notifications') is not null then
    delete from public.notifications where id is not null;
    get diagnostics v_notes = row_count;
  end if;

  delete from public.logs where id is not null;
  get diagnostics v_logs = row_count;

  if to_regclass('public.gigs') is not null then
    delete from public.gigs where id is not null;
    get diagnostics v_gigs = row_count;
  end if;

  if to_regclass('public.auctions') is not null then
    delete from public.auctions where id is not null;
    get diagnostics v_auctions = row_count;
  end if;

  update public.nodes
  set
    ice = 100,
    owner_faction = null,
    compromised = false,
    ddos_until = null
  where type = 'server';
  get diagnostics v_nodes = row_count;

  if to_regclass('public.faction_scores') is not null then
    update public.faction_scores
    set score = 0, updated_at = timezone('utc', now())
    where faction is not null;
  end if;

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
    target_slot_id = null,
    locked_until = null,
    backdoor_until = null,
    backdoor_owner_id = null,
    is_immune = false
  where id is not null;
  get diagnostics v_slots = row_count;

  perform public.zt_ensure_server_backdoors();

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    status = 'idle',
    creds = 150,
    reputation = 3,
    pa = public.zt_pa_max(),
    heat = 0,
    pa_refreshed_at = timezone('utc', now()),
    inventory = '[]'::jsonb,
    owned_hardware = '{}',
    equipped_hardware = null,
    is_blocked = false,
    frozen_until = null,
    nda_until = null,
    kick_immune_until = null,
    has_legal_shield = false,
    spoof_until = null,
    spoof_as_user_id = null,
    stealth_until = null,
    equipment_cooldown_until = null,
    travel_until = null,
    travel_intent = null,
    ability_cooldowns = '{}'::jsonb,
    cooldowns = '{}'::jsonb,
    buffs = '{}',
    current_node_id = null
  where id is not null;
  get diagnostics v_profiles = row_count;

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    updated_at = timezone('utc', now())
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'logs_deleted', v_logs,
    'gigs_deleted', v_gigs,
    'auctions_deleted', v_auctions,
    'servers_reset', v_nodes,
    'slots_cleared', v_slots,
    'profiles', v_profiles,
    'notifications_deleted', v_notes
  );
end;
$$;

grant execute on function public.reset_total() to authenticated;

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

  perform public.zt_clear_slot_row(v_slot.id);

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

grant execute on function public.abort_action(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
