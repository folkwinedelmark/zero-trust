-- =============================================================================
-- ZERO TRUST — phase39: Night Truce, player settings, notifications, PWA prep
-- Esegui nell'SQL Editor (dopo phase38).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings JSONB su profiles (tabella Users del GDD)
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists settings jsonb not null default
    '{"push_notifications": false, "sound": true}'::jsonb;

update public.profiles
set settings = '{"push_notifications": false, "sound": true}'::jsonb || coalesce(settings, '{}'::jsonb)
where settings is null
   or not (settings ? 'push_notifications');

comment on column public.profiles.settings is
  'Preferenze client: push_notifications, sound, ecc.';

-- -----------------------------------------------------------------------------
-- Night Truce — finestra attiva 08:00–23:00 Europe/Rome
-- -----------------------------------------------------------------------------
create or replace function public.zt_is_night_truce(
  p_at timestamptz default timezone('utc', now())
)
returns boolean
language sql
stable
as $$
  select extract(hour from timezone('Europe/Rome', p_at))::int not between 8 and 22;
$$;

create or replace function public.zt_assert_daytime()
returns void
language plpgsql
stable
as $$
begin
  if public.zt_is_night_truce() then
    raise exception
      'Operazione negata: I server sono in modalità manutenzione notturna (23:00 - 08:00).';
  end if;
end;
$$;

-- Claim slot (start_action / extract / trace / kick): niente nuove occupazioni di notte
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

  perform public.zt_assert_daytime();
  return NEW;
end;
$$;

drop trigger if exists trg_slots_night_truce on public.slots;
create trigger trg_slots_night_truce
  before insert or update on public.slots
  for each row
  execute function public.zt_forbid_night_truce_slot();

-- use_ability: blocca lo spend PA (copre tutte le abilità di classe)
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
  perform public.zt_assert_daytime();

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

-- Hub purchases
create or replace function public.afterlife_buy(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rep int;
  v_creds int;
  v_inv jsonb;
  v_owned text[];
  v_equipped text;
  v_base int;
  v_price int;
  v_kind text;
  v_entry jsonb;
  v_auto_equip boolean := false;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_daytime();

  v_base := public.zt_item_base_price(p_item_id);
  if v_base is null then
    raise exception 'Item sconosciuto';
  end if;

  if p_item_id in ('ram', 'gps', 'crypto_nic', 'heuristic') then
    v_kind := 'hardware';
  elsif p_item_id in ('ddos', 'bailout', 'intel', 'jammer', 'lockout', 'wiper') then
    v_kind := 'software';
  else
    raise exception 'Usa afterlife_helpdesk per i servizi IT';
  end if;

  select reputation, creds, inventory, owned_hardware, equipped_hardware
  into v_rep, v_creds, v_inv, v_owned, v_equipped
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if v_kind = 'hardware' then
    if v_owned @> array[p_item_id]::text[] then
      raise exception 'Hardware già in possesso';
    end if;
    v_auto_equip := (v_equipped is null);
    update public.profiles
    set
      creds = creds - v_price,
      owned_hardware = array_append(owned_hardware, p_item_id),
      equipped_hardware = coalesce(equipped_hardware, p_item_id),
      equipment_cooldown_until = case
        when v_auto_equip then timezone('utc', now()) + interval '30 seconds'
        else equipment_cooldown_until
      end
    where id = v_actor;
  else
    if public.zt_software_inventory_len(v_inv) >= 3 then
      raise exception 'Inventario pieno (3 slot)';
    end if;
    v_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'itemId', p_item_id,
      'at', timezone('utc', now())
    );
    update public.profiles
    set
      creds = creds - v_price,
      inventory = coalesce(inventory, '[]'::jsonb) || jsonb_build_array(v_entry)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'kind', v_kind, 'item_id', p_item_id);
end;
$$;

create or replace function public.afterlife_helpdesk(p_service text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rep int;
  v_creds int;
  v_blocked boolean;
  v_heat int;
  v_pa int;
  v_base int;
  v_price int;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  perform public.zt_assert_daytime();

  v_base := public.zt_item_base_price(p_service);
  if v_base is null or p_service not in ('unlock', 'wipe', 'coffee') then
    raise exception 'Servizio Helpdesk non valido';
  end if;

  select reputation, creds, is_blocked, heat, pa
  into v_rep, v_creds, v_blocked, v_heat, v_pa
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);

  if p_service = 'unlock' and not v_blocked then
    raise exception 'Account già operativo';
  end if;
  if p_service = 'wipe' and v_heat <= 0 then
    raise exception 'Heat già a zero';
  end if;
  if p_service = 'coffee' and v_pa >= 4 then
    raise exception 'Operazione negata: Hai già i PA al massimo.';
  end if;
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if p_service = 'unlock' then
    update public.profiles
    set creds = creds - v_price, is_blocked = false
    where id = v_actor;
  elsif p_service = 'wipe' then
    update public.profiles
    set creds = creds - v_price, heat = 0
    where id = v_actor;
  else
    update public.profiles
    set creds = creds - v_price, pa = least(4, pa + 1)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'service', p_service);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications (inbox in-game; push provider in una fase successiva)
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  read boolean not null default false
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

create or replace function public.zt_insert_notification(
  p_user_id uuid,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, title, body)
  values (p_user_id, p_title, p_body);
exception when others then
  raise warning 'zt_insert_notification failed: %', SQLERRM;
end;
$$;

-- Trigger 1: ATTACK / EXTRACT sui server di fazione → SysAdmin alleati
create or replace function public.zt_notify_intrusion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.faction_type;
  v_name text;
  v_admin record;
begin
  if NEW.user_id is null then
    return NEW;
  end if;
  if NEW.action_type is distinct from 'attack'
     and NEW.action_type is distinct from 'extract' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.user_id is not distinct from NEW.user_id
     and OLD.action_type is not distinct from NEW.action_type
     and OLD.start_time is not distinct from NEW.start_time then
    return NEW;
  end if;

  select owner_faction, name
  into v_owner, v_name
  from public.nodes
  where id = NEW.node_id;

  if v_owner is null then
    return NEW;
  end if;

  for v_admin in
    select id
    from public.profiles
    where role = 'sysadmin'
      and faction = v_owner
      and id is distinct from NEW.user_id
  loop
    perform public.zt_insert_notification(
      v_admin.id,
      'Allarme Intrusione',
      format('Allarme Intrusione: Attacco rilevato su %s!', coalesce(v_name, 'Server'))
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_slots_notify_intrusion on public.slots;
create trigger trg_slots_notify_intrusion
  after insert or update on public.slots
  for each row
  execute function public.zt_notify_intrusion();

-- Trigger 2a: TRACE / KICK / abilità ostili andati a segno (via logs)
create or replace function public.zt_notify_hostile_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ability text;
  v_result text;
begin
  if NEW.target_id is null or NEW.target_id is not distinct from NEW.actor_id then
    return NEW;
  end if;

  if NEW.event_type in ('trace_received', 'kick_received')
     and coalesce(NEW.outcome, 'success') = 'success' then
    perform public.zt_insert_notification(
      NEW.target_id,
      'Allarme Sicurezza',
      'Allarme Sicurezza: Sei stato bersagliato da un''operazione ostile.'
    );
    return NEW;
  end if;

  if NEW.event_type = 'ability' then
    v_ability := coalesce(NEW.meta ->> 'ability_id', '');
    v_result := coalesce(NEW.meta ->> 'result', '');
    if v_ability = 'deep_scan'
       or (v_ability = 'kill_process' and v_result = 'kicked') then
      perform public.zt_insert_notification(
        NEW.target_id,
        'Allarme Sicurezza',
        'Allarme Sicurezza: Sei stato bersagliato da un''operazione ostile.'
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_logs_notify_hostile on public.logs;
create trigger trg_logs_notify_hostile
  after insert on public.logs
  for each row
  execute function public.zt_notify_hostile_log();

-- Trigger 2b: NDA / Asset Freeze applicati sul profilo
create or replace function public.zt_notify_hostile_effect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.nda_until is not null
     and NEW.nda_until > timezone('utc', now())
     and NEW.nda_until is distinct from OLD.nda_until then
    perform public.zt_insert_notification(
      NEW.id,
      'Allarme Sicurezza',
      'Allarme Sicurezza: Sei stato bersagliato da un''operazione ostile.'
    );
  elsif NEW.frozen_until is not null
     and NEW.frozen_until > timezone('utc', now())
     and NEW.frozen_until is distinct from OLD.frozen_until then
    perform public.zt_insert_notification(
      NEW.id,
      'Allarme Sicurezza',
      'Allarme Sicurezza: Sei stato bersagliato da un''operazione ostile.'
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_notify_hostile on public.profiles;
create trigger trg_profiles_notify_hostile
  after update of nda_until, frozen_until on public.profiles
  for each row
  execute function public.zt_notify_hostile_effect();

-- Merge patch JSONB sulle settings del chiamante
create or replace function public.update_player_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_settings jsonb;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Patch settings non valida';
  end if;

  update public.profiles
  set settings = coalesce(settings, '{}'::jsonb) || p_patch
  where id = v_actor
  returning settings into v_settings;

  if v_settings is null then
    raise exception 'Profilo non trovato';
  end if;

  return v_settings;
end;
$$;

-- Reset totale: svuota anche la inbox
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
    is_backdoor = false,
    backdoor_until = null,
    backdoor_owner_id = null
  where id is not null;
  get diagnostics v_slots = row_count;

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    status = 'idle',
    creds = 150,
    reputation = 3,
    pa = 4,
    heat = 0,
    pa_refreshed_at = timezone('utc', now()),
    inventory = '[]'::jsonb,
    owned_hardware = '{}',
    equipped_hardware = null,
    is_blocked = false,
    frozen_until = null,
    nda_until = null,
    kick_immune_until = null,
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

grant execute on function public.zt_is_night_truce(timestamptz) to authenticated;
grant execute on function public.zt_assert_daytime() to authenticated;
grant execute on function public.update_player_settings(jsonb) to authenticated;
grant execute on function public.afterlife_buy(text) to authenticated;
grant execute on function public.afterlife_helpdesk(text) to authenticated;
grant execute on function public.reset_total() to authenticated;

notify pgrst, 'reload schema';
