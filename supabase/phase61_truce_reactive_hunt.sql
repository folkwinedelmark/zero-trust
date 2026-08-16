-- =============================================================================
-- ZERO TRUST — phase61: Night Truce reactive Trace/Kick
-- Esegui nell'SQL Editor (dopo phase60).
--
-- Durante la tregua (23:00–07:59 Europe/Rome) restano bloccate le nuove
-- operazioni (attack/defend/farm/extract). Trace e Kick sono ammessi solo se
-- il bersaglio ha già un'operazione core in corso (anti-exploit last-second).
-- =============================================================================

create or replace function public.zt_target_has_active_operation(p_target_slot_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.slots s
    where s.id = p_target_slot_id
      and s.action_type is not null
      and (
        s.user_id is not null
        or coalesce(s.is_decoy, false)
      )
      and (
        s.action_type in ('attack', 'defend', 'farm', 'extract')
        or (
          coalesce(s.is_decoy, false)
          and coalesce(s.spoofed_action, s.action_type, 'farm')
            in ('attack', 'defend', 'farm', 'extract')
        )
      )
  );
$$;

comment on function public.zt_target_has_active_operation(uuid) is
  'True se lo slot ha un''operazione core in corso (o un decoy che la finge).';

create or replace function public.zt_assert_slot_action_allowed(
  p_action_type public.action_type,
  p_target_slot_id uuid default null
)
returns void
language plpgsql
stable
as $$
begin
  if not public.zt_is_night_truce() then
    return;
  end if;

  if p_action_type in ('trace', 'kick')
     and public.zt_target_has_active_operation(p_target_slot_id) then
    return;
  end if;

  raise exception
    'Operazione negata: I server sono in modalità manutenzione notturna (23:00 - 08:00).';
end;
$$;

comment on function public.zt_assert_slot_action_allowed(public.action_type, uuid) is
  'Blocca le nuove ops in Night Truce; consente Trace/Kick reattivi su target occupati.';

-- Trigger: nuove occupazioni di slot. Continua a lasciare correre le ops già avviate.
create or replace function public.zt_forbid_night_truce_slot()
returns trigger
language plpgsql
as $$
begin
  if NEW.user_id is null or NEW.action_type is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and OLD.user_id is not distinct from NEW.user_id
     and OLD.action_type is not distinct from NEW.action_type
     and OLD.start_time is not distinct from NEW.start_time then
    return NEW;
  end if;

  perform public.zt_assert_slot_action_allowed(NEW.action_type, NEW.target_slot_id);
  return NEW;
end;
$$;

drop trigger if exists trg_slots_night_truce on public.slots;
create trigger trg_slots_night_truce
  before insert or update on public.slots
  for each row
  execute function public.zt_forbid_night_truce_slot();

-- start_action: stessa logica della phase43, con truce reattiva al posto del blocco totale
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

  perform public.zt_assert_slot_action_allowed(p_action_type, p_target_slot_id);

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

grant execute on function public.zt_target_has_active_operation(uuid) to authenticated;
grant execute on function public.zt_assert_slot_action_allowed(public.action_type, uuid) to authenticated;
grant execute on function public.start_action(
  uuid, public.action_type, timestamptz, timestamptz, uuid, uuid, integer
) to authenticated;

notify pgrst, 'reload schema';
