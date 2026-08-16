-- =============================================================================
-- ZERO TRUST — phase62: notifications table, intrusion/hostile triggers
-- Esegui nell'SQL Editor (dopo phase61).
--
-- Inbox in-game (tabella notifications). I client con push_notifications=true
-- e permesso browser possono ricevere gli stessi eventi via service worker
-- quando il provider push è collegato.
--
-- GDD "Users" = public.profiles (1:1 con auth.users). Classe = profiles.role.
-- =============================================================================

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

-- Trigger 1: ATTACK / EXTRACT su un server → SysAdmin della fazione proprietaria
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
      '🚨 ALLARME INTRUSIONE',
      format(
        'Attacco o estrazione rilevata sul server %s! Intervieni subito.',
        coalesce(v_name, 'Server')
      )
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
      '⚠️ VIOLAZIONE DI SICUREZZA',
      'Sei stato bersagliato da un''operazione ostile sulla rete.'
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
        '⚠️ VIOLAZIONE DI SICUREZZA',
        'Sei stato bersagliato da un''operazione ostile sulla rete.'
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
      '⚠️ VIOLAZIONE DI SICUREZZA',
      'Sei stato bersagliato da un''operazione ostile sulla rete.'
    );
  elsif NEW.frozen_until is not null
     and NEW.frozen_until > timezone('utc', now())
     and NEW.frozen_until is distinct from OLD.frozen_until then
    perform public.zt_insert_notification(
      NEW.id,
      '⚠️ VIOLAZIONE DI SICUREZZA',
      'Sei stato bersagliato da un''operazione ostile sulla rete.'
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

notify pgrst, 'reload schema';
