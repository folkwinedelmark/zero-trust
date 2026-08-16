-- =============================================================================
-- ZERO TRUST — phase40: MAX_PA 5 + auto-unblock al Daily Tick
-- Esegui nell'SQL Editor (dopo phase39). Idempotente.
--
-- Una sola fonte di verità lato DB: public.zt_pa_max() → 5
-- Daily tick: PA → max, Heat −1, is_blocked → false
-- Energy Coffee usa zt_pa_max() (niente 4/5 hardcoded nella RPC)
-- Cron opzionale: 08:00 Europe/Rome
-- =============================================================================

create or replace function public.zt_pa_max()
returns integer
language sql
immutable
as $$
  select 5;
$$;

-- -----------------------------------------------------------------------------
-- Cap PA
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_pa_check;
alter table public.profiles
  add constraint profiles_pa_check check (pa >= 0 and pa <= public.zt_pa_max());

alter table public.profiles
  alter column pa set default public.zt_pa_max();

-- -----------------------------------------------------------------------------
-- Daily Tick: PA 5 + sblocco automatico
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

  v_corp_score := public.zt_add_faction_score('security', v_corp);
  v_rebel_score := public.zt_add_faction_score('hacktivist', v_rebel);

  -- WHERE obbligatorio: PostgREST/safe-update rifiuta UPDATE senza condizione.
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
      '[SYSTEM] Ciclo di 24 ore completato. Punti Vittoria assegnati, PA ripristinati, Heat −1, account sbloccati.',
      'info',
      jsonb_build_object(
        'tone', 'info',
        'corp_servers', v_corp,
        'rebel_servers', v_rebel,
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
    'corp_score', v_corp_score,
    'rebel_score', v_rebel_score,
    'profiles_refreshed', v_refreshed,
    'profiles_unblocked', v_unblocked
  );
end;
$$;

grant execute on function public.simulate_daily_tick() to authenticated;

-- -----------------------------------------------------------------------------
-- Helpdesk Energy Coffee: cap 5
-- -----------------------------------------------------------------------------
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
  v_pa_max int := public.zt_pa_max();
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
  if p_service = 'coffee' and v_pa >= v_pa_max then
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
    set creds = creds - v_price, pa = least(v_pa_max, pa + 1)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'service', p_service);
end;
$$;

grant execute on function public.afterlife_helpdesk(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Reset totale: PA iniziale 5
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Cron 08:00 Europe/Rome (opzionale; no-op se pg_cron non è abilitato)
-- 08:00 CEST = 06:00 UTC · 08:00 CET = 07:00 UTC
-- -----------------------------------------------------------------------------
create or replace function public.zt_run_daily_tick_at_rome_morning()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_char(timezone('Europe/Rome', now()), 'HH24:MI') not between '08:00' and '08:04' then
    return jsonb_build_object('ok', false, 'skipped', true);
  end if;
  return public.simulate_daily_tick();
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(j.jobid)
      from cron.job j
      where j.jobname in ('zt-daily-tick', 'zt_daily_tick');
    exception when others then
      null;
    end;
    perform cron.schedule(
      'zt-daily-tick',
      '0 6,7 * * *',
      $cron$select public.zt_run_daily_tick_at_rome_morning()$cron$
    );
  else
    raise notice 'pg_cron non disponibile: daily tick resta manuale (God Mode).';
  end if;
exception when others then
  raise notice 'Scheduling daily tick saltato: %', SQLERRM;
end;
$$;

notify pgrst, 'reload schema';
