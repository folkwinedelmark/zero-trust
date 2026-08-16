-- =============================================================================
-- ZERO TRUST — phase29: Class abilities + ability_cooldowns
-- Esegui nell'SQL Editor (dopo phase28).
-- Classe già su profiles.role (sysadmin / ghost / analyst / executive).
-- =============================================================================

-- Slot D per Backdoor Ghost (non usabile nello stesso statement di ADD VALUE)
alter type public.slot_label add value if not exists 'D';

alter table public.profiles
  add column if not exists ability_cooldowns jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists kick_immune_until timestamptz;

alter table public.profiles
  add column if not exists nda_until timestamptz;

alter table public.profiles
  add column if not exists spoof_as_user_id uuid references public.profiles (id) on delete set null;

alter table public.profiles
  add column if not exists spoof_until timestamptz;

alter table public.slots
  add column if not exists is_backdoor boolean not null default false;

alter table public.slots
  add column if not exists backdoor_until timestamptz;

alter table public.slots
  add column if not exists backdoor_owner_id uuid references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Sweep decoy / backdoor scaduti
-- -----------------------------------------------------------------------------
create or replace function public.zt_sweep_class_effects()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decoys int := 0;
  v_doors int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

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
  where is_decoy
    and end_time is not null
    and end_time <= timezone('utc', now());
  get diagnostics v_decoys = row_count;

  delete from public.slots
  where is_backdoor
    and user_id is null
    and backdoor_until is not null
    and backdoor_until <= timezone('utc', now());
  get diagnostics v_doors = row_count;

  return jsonb_build_object('ok', true, 'decoys_cleared', v_decoys, 'backdoors_cleared', v_doors);
end;
$$;

-- -----------------------------------------------------------------------------
-- Catalogo abilità
-- -----------------------------------------------------------------------------
create or replace function public.zt_ability_def(p_ability_id text)
returns table (
  ability_id text,
  required_role public.role_type,
  pa_cost integer,
  cooldown interval
)
language sql
immutable
as $$
  select
    d.ability_id,
    d.required_role,
    d.pa_cost,
    d.cooldown
  from (
    values
      ('hotfix',          'sysadmin'::public.role_type, 1, interval '24 hours'),
      ('kill_process',    'sysadmin',                   1, interval '24 hours'),
      ('hard_reboot',     'sysadmin',                   3, interval '7 days'),
      ('decoy',           'ghost',                      1, interval '24 hours'),
      ('backdoor',        'ghost',                      1, interval '24 hours'),
      ('identity_spoof',  'ghost',                      3, interval '7 days'),
      ('deep_scan',       'analyst',                    1, interval '24 hours'),
      ('background_check','analyst',                    1, interval '24 hours'),
      ('doxxing',         'analyst',                    3, interval '7 days'),
      ('immunity',        'executive',                  1, interval '24 hours'),
      ('nda',             'executive',                  1, interval '24 hours'),
      ('asset_freeze',    'executive',                  3, interval '7 days')
  ) as d(ability_id, required_role, pa_cost, cooldown)
  where d.ability_id = p_ability_id;
$$;

create or replace function public.zt_is_kick_immune(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.slots s on s.user_id = p.id
    where p.id = p_user_id
      and p.kick_immune_until is not null
      and p.kick_immune_until > timezone('utc', now())
      and s.action_type in ('attack', 'defend', 'farm', 'extract')
  );
$$;

create or replace function public.zt_is_frozen(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.frozen_until is not null
      and p.frozen_until > timezone('utc', now())
  );
$$;

create or replace function public.zt_is_nda_blocked(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.nda_until is not null
      and p.nda_until > timezone('utc', now())
  );
$$;

create or replace function public.zt_ghost_revealed_name(p_profile public.profiles)
returns text
language plpgsql
stable
as $$
declare
  v_spoof text;
begin
  if p_profile.role is distinct from 'ghost' then
    return p_profile.name;
  end if;

  if p_profile.spoof_until is not null
     and p_profile.spoof_until > timezone('utc', now())
     and p_profile.spoof_as_user_id is not null then
    select name into v_spoof
    from public.profiles
    where id = p_profile.spoof_as_user_id;
    if v_spoof is not null then
      return v_spoof;
    end if;
  end if;

  return 'ENCRYPTED ID';
end;
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
    target_slot_id = null
  where id = p_slot_id;
end;
$$;

-- Kick condiviso: immune / bailed / kicked / decoy / empty
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
    target_slot_id = null
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

create or replace function public.zt_spend_ability(
  p_ability_id text,
  p_actor uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def record;
  v_profile public.profiles%rowtype;
  v_key text;
  v_last timestamptz;
  v_cds jsonb;
begin
  select * into v_def from public.zt_ability_def(p_ability_id);
  if not found then
    raise exception 'Abilità sconosciuta';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;

  if v_profile.is_blocked then
    raise exception 'Account BLOCKED: abilità non disponibili';
  end if;

  if v_profile.role is distinct from v_def.required_role then
    raise exception 'Classe incompatibile con questa abilità';
  end if;

  if v_profile.pa < v_def.pa_cost then
    raise exception 'PA insufficienti (servono % PA)', v_def.pa_cost;
  end if;

  v_key := p_ability_id || '_last_used';
  v_cds := coalesce(v_profile.ability_cooldowns, '{}'::jsonb);
  if v_cds ? v_key then
    begin
      v_last := (v_cds ->> v_key)::timestamptz;
    exception when others then
      v_last := null;
    end;
    if v_last is not null and v_last + v_def.cooldown > timezone('utc', now()) then
      raise exception 'Abilità in cooldown (% s)',
        greatest(1, ceil(extract(epoch from ((v_last + v_def.cooldown) - timezone('utc', now())))))::int;
    end if;
  end if;

  v_cds := v_cds || jsonb_build_object(v_key, timezone('utc', now()));

  update public.profiles
  set
    pa = pa - v_def.pa_cost,
    ability_cooldowns = v_cds
  where id = p_actor
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.zt_log_ability(
  p_actor uuid,
  p_ability_id text,
  p_message text,
  p_node_id uuid default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
begin
  insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
  values (
    p_node_id,
    p_actor,
    p_target_id,
    'ability',
    p_message,
    'success',
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
      'ability_id', p_ability_id,
      'tone', 'info'
    )
  );
exception when others then
  raise warning 'zt_log_ability failed: %', SQLERRM;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger: Asset Freeze (niente spese) + NDA (niente gigs)
-- -----------------------------------------------------------------------------
create or replace function public.zt_enforce_asset_freeze()
returns trigger
language plpgsql
as $$
begin
  if NEW.creds < OLD.creds
     and OLD.frozen_until is not null
     and OLD.frozen_until > timezone('utc', now()) then
    raise exception 'Asset Freeze: non puoi spendere crediti per 24h.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_asset_freeze on public.profiles;
create trigger trg_profiles_asset_freeze
  before update of creds on public.profiles
  for each row
  execute function public.zt_enforce_asset_freeze();

create or replace function public.zt_enforce_nda()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if public.zt_is_nda_blocked(NEW.creator_id) then
      raise exception 'NDA: non puoi interagire con i Gigs per 8h.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.executor_id is not null
       and NEW.executor_id is distinct from OLD.executor_id
       and public.zt_is_nda_blocked(NEW.executor_id) then
      raise exception 'NDA: non puoi interagire con i Gigs per 8h.';
    end if;
    if NEW.creator_id is distinct from OLD.creator_id
       and public.zt_is_nda_blocked(NEW.creator_id) then
      raise exception 'NDA: non puoi interagire con i Gigs per 8h.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_gigs_nda on public.gigs;
create trigger trg_gigs_nda
  before insert or update on public.gigs
  for each row
  execute function public.zt_enforce_nda();

create or replace function public.zt_enforce_backdoor_owner()
returns trigger
language plpgsql
as $$
begin
  if OLD.is_backdoor
     and NEW.user_id is not null
     and NEW.user_id is distinct from OLD.backdoor_owner_id then
    raise exception 'Backdoor riservato al Ghost proprietario';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_slots_backdoor_owner on public.slots;
create trigger trg_slots_backdoor_owner
  before update of user_id on public.slots
  for each row
  execute function public.zt_enforce_backdoor_owner();

-- -----------------------------------------------------------------------------
-- RPC generica
-- -----------------------------------------------------------------------------
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
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_node public.nodes%rowtype;
  v_slot public.slots%rowtype;
  v_target public.profiles%rowtype;
  v_payload jsonb := '{}'::jsonb;
  v_ice_before int;
  v_ice_after int;
  v_sign int;
  v_start timestamptz;
  v_end timestamptz;
  v_free int;
  v_door uuid;
  v_kick text;
  v_revealed text;
  v_faction text;
  v_action text;
  v_logs jsonb;
  v_node_name text;
  v_label text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_sweep_class_effects();

  v_profile := public.zt_spend_ability(p_ability_id, v_actor);

  -- SYSADMIN: Hotfix ----------------------------------------------------------
  if p_ability_id = 'hotfix' then
    if p_node_id is null then
      raise exception 'Nodo richiesto';
    end if;
    select * into v_node from public.nodes where id = p_node_id and type = 'server';
    if not found then
      raise exception 'Server non valido';
    end if;
    v_sign := case when coalesce(p_ice_sign, 1) < 0 then -1 else 1 end;
    v_ice_before := coalesce(v_node.ice, 0);
    v_ice_after := greatest(0, least(100, v_ice_before + (5 * v_sign)));
    update public.nodes set ice = v_ice_after where id = v_node.id;
    v_payload := jsonb_build_object(
      'ice_before', v_ice_before,
      'ice_after', v_ice_after,
      'delta', 5 * v_sign,
      'node_name', v_node.name
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Hotfix: ICE %s%% → %s%% — Server: %s', v_ice_before, v_ice_after, v_node.name),
      v_node.id, null, v_payload
    );

  -- SYSADMIN: Kill Process ----------------------------------------------------
  elsif p_ability_id = 'kill_process' then
    if p_target_slot_id is null then
      raise exception 'Slot bersaglio richiesto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    if v_slot.user_id is null and not v_slot.is_decoy then
      raise exception 'Slot non occupato';
    end if;
    if v_slot.user_id = v_actor then
      raise exception 'Non puoi kickare te stesso';
    end if;
    if not v_slot.is_decoy
       and not public.zt_is_huntable_action(v_slot.action_type) then
      raise exception 'Segnale instabile: il bersaglio non è ancorato a un''azione core.';
    end if;
    v_kick := public.zt_resolve_kick_target(v_slot.user_id, v_slot.id);
    select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
    v_payload := jsonb_build_object(
      'result', v_kick,
      'target_slot', v_slot.slot_id::text,
      'node_name', v_node_name
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format(
        'Kill Process: %s su Slot %s — Server: %s',
        case v_kick
          when 'kicked' then 'kick istantaneo'
          when 'decoy' then 'decoy rimosso'
          when 'bailed' then 'vanificato da Bailout'
          when 'immune' then 'vanificato da Immunity'
          else v_kick
        end,
        v_slot.slot_id::text, coalesce(v_node_name, 'Server')
      ),
      v_slot.node_id,
      v_slot.user_id,
      v_payload
    );

  -- SYSADMIN: Hard Reboot -----------------------------------------------------
  elsif p_ability_id = 'hard_reboot' then
    if p_node_id is null then
      raise exception 'Nodo richiesto';
    end if;
    select * into v_node from public.nodes where id = p_node_id and type = 'server';
    if not found then
      raise exception 'Server non valido';
    end if;
    v_ice_before := coalesce(v_node.ice, 0);
    update public.nodes set ice = 50 where id = v_node.id;
    v_payload := jsonb_build_object(
      'ice_before', v_ice_before,
      'ice_after', 50,
      'node_name', v_node.name
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Hard Reboot: ICE forzato a 50%% (era %s%%) — Server: %s', v_ice_before, v_node.name),
      v_node.id, null, v_payload
    );

  -- GHOST: Decoy --------------------------------------------------------------
  elsif p_ability_id = 'decoy' then
    if p_target_slot_id is null then
      raise exception 'Slot vuoto richiesto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id for update;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    if v_slot.user_id is not null or v_slot.is_decoy then
      raise exception 'Lo slot non è libero';
    end if;
    if v_slot.locked_until is not null and v_slot.locked_until > timezone('utc', now()) then
      raise exception 'Slot locked';
    end if;
    v_start := timezone('utc', now());
    v_end := v_start + interval '1 hour';
    update public.slots
    set
      is_decoy = true,
      action_type = 'farm',
      start_time = v_start,
      end_time = v_end,
      spoofed_action = 'farm'
    where id = v_slot.id;
    select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
    v_payload := jsonb_build_object(
      'slot', v_slot.slot_id::text,
      'node_name', v_node_name,
      'until', v_end
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Decoy attivo 1h su Slot %s — Server: %s', v_slot.slot_id::text, coalesce(v_node_name, 'Server')),
      v_slot.node_id, null, v_payload
    );

  -- GHOST: Backdoor -----------------------------------------------------------
  elsif p_ability_id = 'backdoor' then
    if p_node_id is null then
      raise exception 'Nodo richiesto';
    end if;
    select * into v_node from public.nodes where id = p_node_id and type = 'server';
    if not found then
      raise exception 'Server non valido';
    end if;
    select count(*) into v_free
    from public.slots
    where node_id = v_node.id
      and user_id is null
      and not is_decoy
      and not is_backdoor
      and (locked_until is null or locked_until <= timezone('utc', now()));
    if v_free > 0 then
      raise exception 'Il server ha ancora slot liberi';
    end if;
    if exists (
      select 1 from public.slots
      where node_id = v_node.id and is_backdoor and user_id is not null
    ) then
      raise exception 'Backdoor già occupato su questo server';
    end if;

    update public.slots
    set
      backdoor_owner_id = v_actor,
      backdoor_until = timezone('utc', now()) + interval '1 hour',
      is_backdoor = true
    where node_id = v_node.id
      and is_backdoor
      and user_id is null
    returning id into v_door;

    if v_door is null then
      execute
        'insert into public.slots (node_id, slot_id, is_backdoor, backdoor_until, backdoor_owner_id)
         values ($1, $2::public.slot_label, true, $3, $4)
         returning id'
      using v_node.id, 'D', timezone('utc', now()) + interval '1 hour', v_actor
      into v_door;
    end if;

    v_payload := jsonb_build_object(
      'slot_id', v_door,
      'slot', 'D',
      'node_name', v_node.name,
      'until', timezone('utc', now()) + interval '1 hour'
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Backdoor: slot D temporaneo su %s (1h)', v_node.name),
      v_node.id, null, v_payload
    );

  -- GHOST: Identity Spoof -----------------------------------------------------
  elsif p_ability_id = 'identity_spoof' then
    if p_target_id is null or p_target_id = v_actor then
      raise exception 'Scegli un agente innocente da impersonare';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;
    update public.profiles
    set
      spoof_as_user_id = p_target_id,
      spoof_until = timezone('utc', now()) + interval '12 hours'
    where id = v_actor;
    v_payload := jsonb_build_object(
      'spoof_as', v_target.name,
      'until', timezone('utc', now()) + interval '12 hours'
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Identity Spoof attivo 12h: i log mostrano %s', v_target.name),
      null, p_target_id, v_payload
    );

  -- ANALYST: Deep Scan --------------------------------------------------------
  elsif p_ability_id = 'deep_scan' then
    if p_target_slot_id is null then
      raise exception 'Slot bersaglio richiesto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
    v_revealed := 'Unknown';
    v_faction := null;
    v_action := coalesce(v_slot.action_type::text, v_slot.spoofed_action::text);

    if v_slot.is_decoy and v_slot.user_id is null then
      v_revealed := 'Unknown';
      v_action := coalesce(v_slot.action_type::text, 'farm');
    elsif v_slot.user_id is not null then
      select * into v_target from public.profiles where id = v_slot.user_id;
      if found then
        if public.zt_is_stealthed(v_target.id) then
          v_revealed := 'Unknown';
          v_action := null;
        else
          v_revealed := public.zt_ghost_revealed_name(v_target);
          update public.profiles
          set heat = least(5, coalesce(heat, 0) + 1)
          where id = v_target.id;
        end if;
      end if;
    else
      raise exception 'Slot non occupato';
    end if;

    v_payload := jsonb_build_object(
      'revealed', v_revealed,
      'target_action', v_action,
      'target_id', v_slot.user_id,
      'target_slot', v_slot.slot_id::text,
      'node_name', v_node_name
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format(
        'Deep Scan: %s — Azione in corso: %s — Server: %s [Slot %s]',
        v_revealed,
        upper(coalesce(v_action, 'UNKNOWN')),
        coalesce(v_node_name, 'Server'),
        v_slot.slot_id::text
      ),
      v_slot.node_id, v_slot.user_id, v_payload
    );

  -- ANALYST: Background Check -------------------------------------------------
  elsif p_ability_id = 'background_check' then
    if p_target_slot_id is null then
      raise exception 'Slot richiesto';
    end if;
    select * into v_slot from public.slots where id = p_target_slot_id;
    if not found then
      raise exception 'Slot non trovato';
    end if;
    v_label := v_slot.slot_id::text;
    select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
    select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    into v_logs
    from (
      select
        l.created_at,
        l.event_type,
        l.message,
        l.outcome,
        l.meta
      from public.logs l
      where l.created_at >= timezone('utc', now()) - interval '24 hours'
        and l.node_id = v_slot.node_id
        and (
          l.meta ->> 'slot' = v_label
          or l.meta ->> 'actor_slot' = v_label
          or l.meta ->> 'target_slot' = v_label
          or l.meta ->> 'compromised_slot' = v_label
        )
      order by l.created_at desc
      limit 80
    ) x;
    v_payload := jsonb_build_object(
      'logs', v_logs,
      'slot', v_label,
      'node_name', v_node_name
    );
    if to_regclass('public.intel_reports') is not null then
      v_payload := v_payload || public.zt_save_intel_report(
        'background_check',
        'SLOT',
        format('%s [Slot %s]', coalesce(v_node_name, 'Server'), v_label),
        v_logs,
        null,
        v_slot.node_id,
        v_label
      );
    end if;
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Background Check: storico 24h Slot %s — Server: %s', v_label, coalesce(v_node_name, 'Server')),
      v_slot.node_id, null, jsonb_build_object('slot', v_label, 'node_name', v_node_name)
    );

  -- ANALYST: Doxxing ----------------------------------------------------------
  elsif p_ability_id = 'doxxing' then
    if p_target_id is null or p_target_id = v_actor then
      raise exception 'Bersaglio richiesto';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;
    select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    into v_logs
    from (
      select
        l.created_at,
        l.event_type,
        l.message,
        l.outcome,
        l.meta
      from public.logs l
      where l.created_at >= timezone('utc', now()) - interval '24 hours'
        and (l.actor_id = p_target_id or l.target_id = p_target_id)
      order by l.created_at desc
      limit 120
    ) x;
    v_payload := jsonb_build_object(
      'logs', v_logs,
      'target_name', v_target.name,
      'target_id', v_target.id
    );
    if to_regclass('public.intel_reports') is not null then
      v_payload := v_payload || public.zt_save_intel_report(
        'doxxing',
        'USER',
        v_target.name,
        v_logs,
        v_target.id,
        null,
        null
      );
    end if;
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Doxxing: storico privato 24h di %s', v_target.name),
      null, p_target_id, jsonb_build_object('target_name', v_target.name)
    );

  -- EXECUTIVE: Immunity -------------------------------------------------------
  elsif p_ability_id = 'immunity' then
    select * into v_slot
    from public.slots
    where user_id = v_actor
      and action_type in ('attack', 'defend', 'farm', 'extract');
    if not found then
      raise exception 'Immunity richiede un''azione in corso';
    end if;
    update public.profiles
    set kick_immune_until = v_slot.end_time
    where id = v_actor;
    select n.name into v_node_name from public.nodes n where n.id = v_slot.node_id;
    v_payload := jsonb_build_object(
      'until', v_slot.end_time,
      'action', v_slot.action_type::text,
      'node_name', v_node_name
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Immunity: i Kick nemici falliscono fino a fine %s — Server: %s [Slot %s]',
        v_slot.action_type::text, coalesce(v_node_name, 'Server'), v_slot.slot_id::text),
      v_slot.node_id, null, v_payload
    );

  -- EXECUTIVE: NDA ------------------------------------------------------------
  elsif p_ability_id = 'nda' then
    if p_target_id is null or p_target_id = v_actor then
      raise exception 'Bersaglio richiesto';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;
    update public.profiles
    set nda_until = timezone('utc', now()) + interval '8 hours'
    where id = p_target_id;
    v_payload := jsonb_build_object(
      'target_name', v_target.name,
      'until', timezone('utc', now()) + interval '8 hours'
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('NDA: %s bloccato dai Gigs per 8h', v_target.name),
      null, p_target_id, v_payload
    );

  -- EXECUTIVE: Asset Freeze ---------------------------------------------------
  elsif p_ability_id = 'asset_freeze' then
    if p_target_id is null or p_target_id = v_actor then
      raise exception 'Bersaglio richiesto';
    end if;
    select * into v_target from public.profiles where id = p_target_id;
    if not found then
      raise exception 'Agente non trovato';
    end if;
    update public.profiles
    set frozen_until = timezone('utc', now()) + interval '24 hours'
    where id = p_target_id;
    v_payload := jsonb_build_object(
      'target_name', v_target.name,
      'until', timezone('utc', now()) + interval '24 hours'
    );
    perform public.zt_log_ability(
      v_actor, p_ability_id,
      format('Asset Freeze: %s non può spendere crediti per 24h', v_target.name),
      null, p_target_id, v_payload
    );

  else
    raise exception 'Abilità non implementata';
  end if;

  return jsonb_build_object(
    'ok', true,
    'ability_id', p_ability_id,
    'pa', (select pa from public.profiles where id = v_actor),
    'result', v_payload
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- execute_kick: Immunity Executive
-- -----------------------------------------------------------------------------
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
  v_immune boolean := false;
  v_kick text;
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

    if v_target_found and (v_target.user_id is not null or v_target.is_decoy) then
      v_target_id := v_target.user_id;
      if v_target_id is not null then
        select p.name into v_target_name from public.profiles p where p.id = v_target_id;
      end if;

      v_kick := public.zt_resolve_kick_target(v_target_id, v_target.id);
      if v_kick = 'immune' then
        v_immune := true;
        v_outcome := 'failure';
      elsif v_kick = 'bailed' then
        v_bailed := true;
        v_outcome := 'failure';
      elsif v_kick in ('kicked', 'decoy') then
        v_outcome := 'success';
      else
        v_outcome := 'failure';
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
        when v_immune then
          format(
            'Fallito: Kick vanificato su %s — Immunity Executive attiva. — Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        when v_bailed then
          format(
            'Fallito: Kick vanificato su %s — Il bersaglio ha attivato un Bailout Token automatico; Kick e blocco account sventati. — Server: %s [Slot %s]',
            v_display_name, v_node_name, coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
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
        'bailed', v_bailed,
        'immune', v_immune,
        'tone', case
          when v_bailed or v_immune then 'warning'
          when v_outcome = 'success' then 'info'
          else 'danger'
        end
      )
    );

    if v_immune and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_actor,
        v_target_id,
        'kick_received',
        format(
          'Tentativo di Kick sventato — Immunity attiva — Server: %s [Slot %s]',
          v_node_name, coalesce(v_target_slot_label, '?')
        ),
        'failure',
        jsonb_build_object(
          'node_name', v_node_name,
          'compromised_slot', v_target_slot_label,
          'tone', 'success',
          'perspective', 'target',
          'immune', true
        )
      );
    elsif v_bailed and v_target_id is not null then
      insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
      values (
        v_slot.node_id,
        v_target_id,
        v_actor,
        'bailout_consumed',
        format(
          'Bailout Token consumato automaticamente: Kick e blocco account evitati su %s. — Server: %s',
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
    elsif v_outcome = 'success' and v_target_id is not null then
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
    'blocked', (v_outcome = 'success' and not v_bailed and not v_immune),
    'bailed', v_bailed,
    'immune', v_immune,
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
-- execute_trace: Ghost ENCRYPTED ID + Identity Spoof
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
          v_revealed := public.zt_ghost_revealed_name(v_target_profile);
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
        when v_action_label is not null then
          format(
            'Successo: Trace completato su %s — azione: %s — Server: %s [Slot %s]',
            v_revealed, v_action_label, v_node_name,
            coalesce(v_target_slot_label, v_slot.slot_id::text)
          )
        else
          format(
            'Successo: Trace completato su %s — Server: %s [Slot %s]',
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
          case when v_revealed in ('ENCRYPTED ID', 'ID CRIPTATO')
            then ' — Stealth: ENCRYPTED ID'
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

grant execute on function public.zt_sweep_class_effects() to authenticated;
grant execute on function public.zt_is_kick_immune(uuid) to authenticated;
grant execute on function public.zt_is_frozen(uuid) to authenticated;
grant execute on function public.zt_is_nda_blocked(uuid) to authenticated;
grant execute on function public.use_ability(text, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.execute_kick(uuid, text, text) to authenticated;
grant execute on function public.execute_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
