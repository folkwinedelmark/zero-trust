-- =============================================================================
-- ZERO TRUST — phase57: Global Player Directory
-- Esegui nell'SQL Editor (dopo phase56).
-- class_revealed + player_notes (deduzioni fazione private).
-- =============================================================================

alter table public.profiles
  add column if not exists class_revealed boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'deduced_faction_type'
  ) then
    create type public.deduced_faction_type as enum (
      'UNKNOWN',
      'CORP',
      'REBEL',
      'MERCENARY'
    );
  end if;
end $$;

create table if not exists public.player_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  deduced_faction public.deduced_faction_type not null default 'UNKNOWN',
  custom_note text,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint player_notes_owner_target_key unique (owner_id, target_user_id),
  constraint player_notes_note_len check (
    custom_note is null or char_length(custom_note) <= 280
  )
);

create index if not exists player_notes_owner_idx
  on public.player_notes (owner_id);

alter table public.player_notes enable row level security;

grant select, insert, update, delete on table public.player_notes to authenticated;

drop policy if exists "player_notes_select_own" on public.player_notes;
create policy "player_notes_select_own"
  on public.player_notes for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "player_notes_insert_own" on public.player_notes;
create policy "player_notes_insert_own"
  on public.player_notes for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "player_notes_update_own" on public.player_notes;
create policy "player_notes_update_own"
  on public.player_notes for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "player_notes_delete_own" on public.player_notes;
create policy "player_notes_delete_own"
  on public.player_notes for delete
  to authenticated
  using (owner_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.player_notes;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Reveal class: once, then personal [NET] log
-- -----------------------------------------------------------------------------
create or replace function public.zt_reveal_class(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  perform set_config('row_security', 'off', true);

  update public.profiles
  set class_revealed = true
  where id = p_user_id
    and class_revealed = false
  returning id into v_id;

  if v_id is null then
    return false;
  end if;

  begin
    insert into public.logs (
      actor_id, event_type, message, outcome, meta
    ) values (
      p_user_id,
      'class_revealed',
      '[NET] La tua classe operativa è stata decifrata dai nodi di rete ed è ora pubblica nella directory.',
      'info',
      jsonb_build_object('tone', 'warning', 'tag', 'NET')
    );
  exception when others then
    raise warning 'zt_reveal_class log failed: %', SQLERRM;
  end;

  return true;
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
security definer
set search_path = public
as $$
begin
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
  begin
    perform public.zt_reveal_class(p_actor);
  exception when others then
    raise warning 'zt_reveal_class failed: %', SQLERRM;
  end;
end;
$$;

-- Core actions that fingerprint a class
create or replace function public.zt_reveal_class_from_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.role_type;
  v_action text;
begin
  if NEW.user_id is null or NEW.action_type is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.action_type is not distinct from NEW.action_type
     and OLD.user_id is not distinct from NEW.user_id then
    return NEW;
  end if;

  select role into v_role
  from public.profiles
  where id = NEW.user_id;

  v_action := NEW.action_type::text;

  if (v_role = 'sysadmin' and v_action in ('defend', 'kick', 'trace'))
     or (v_role = 'analyst' and v_action = 'trace')
     or (v_role = 'ghost' and v_action = 'attack')
     or (v_role = 'executive' and v_action = 'farm') then
    perform public.zt_reveal_class(NEW.user_id);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_slots_reveal_class on public.slots;
create trigger trg_slots_reveal_class
  after insert or update of user_id, action_type on public.slots
  for each row
  execute function public.zt_reveal_class_from_slot();

create or replace function public.upsert_player_note(
  p_target_id uuid,
  p_deduced_faction text default 'UNKNOWN',
  p_custom_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_faction public.deduced_faction_type;
  v_note text;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;
  if p_target_id is null then
    raise exception 'Bersaglio richiesto';
  end if;

  begin
    v_faction := upper(coalesce(nullif(trim(p_deduced_faction), ''), 'UNKNOWN'))::public.deduced_faction_type;
  exception when others then
    v_faction := 'UNKNOWN';
  end;

  v_note := nullif(trim(both from coalesce(p_custom_note, '')), '');
  if v_note is not null and char_length(v_note) > 280 then
    v_note := left(v_note, 280);
  end if;

  insert into public.player_notes (
    owner_id, target_user_id, deduced_faction, custom_note, updated_at
  ) values (
    v_actor, p_target_id, v_faction, v_note, timezone('utc', now())
  )
  on conflict (owner_id, target_user_id) do update
  set
    deduced_faction = excluded.deduced_faction,
    custom_note = excluded.custom_note,
    updated_at = timezone('utc', now())
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'deduced_faction', v_faction,
    'custom_note', v_note
  );
end;
$$;

grant execute on function public.upsert_player_note(uuid, text, text) to authenticated;
revoke execute on function public.zt_reveal_class(uuid) from public, anon, authenticated;
revoke execute on function public.zt_reveal_class_from_slot() from public, anon, authenticated;

-- reset_total: hide classes again + wipe notes
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
  v_intel int := 0;
  v_dir_notes int := 0;
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

  if to_regclass('public.player_notes') is not null then
    delete from public.player_notes where id is not null;
    get diagnostics v_dir_notes = row_count;
  end if;

  delete from public.logs where id is not null;
  get diagnostics v_logs = row_count;

  if to_regclass('public.intel_reports') is not null then
    delete from public.intel_reports where id is not null;
    get diagnostics v_intel = row_count;
  end if;

  if to_regclass('public.gigs') is not null then
    delete from public.gigs where id is not null;
    get diagnostics v_gigs = row_count;
  end if;

  if to_regclass('public.auctions') is not null then
    delete from public.auctions where id is not null;
    get diagnostics v_auctions = row_count;
  end if;

  v_nodes := public.zt_assign_starting_servers();

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
    equipped_hardware = '{}'::text[],
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
    current_node_id = null,
    class_revealed = false
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
    'intel_deleted', v_intel,
    'gigs_deleted', v_gigs,
    'auctions_deleted', v_auctions,
    'servers_reset', v_nodes,
    'slots_cleared', v_slots,
    'profiles', v_profiles,
    'notifications_deleted', v_notes,
    'directory_notes_deleted', v_dir_notes
  );
end;
$$;

grant execute on function public.reset_total() to authenticated;

notify pgrst, 'reload schema';
