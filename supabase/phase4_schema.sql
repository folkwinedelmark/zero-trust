-- =============================================================================
-- ZERO TRUST — Fase 4: Contromisure (Trace / Kick) + Logs
-- Esegui nell'SQL Editor di Supabase.
-- =============================================================================

-- Target dello slot su cui stai facendo Trace/Kick (mentre tu occupi uno slot libero)
alter table public.slots
  add column if not exists target_slot_id uuid references public.slots (id) on delete set null;

create index if not exists slots_target_slot_id_idx on public.slots (target_slot_id);

-- =============================================================================
-- LOGS
-- =============================================================================
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references public.nodes (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  target_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists logs_node_id_idx on public.logs (node_id);
create index if not exists logs_created_at_idx on public.logs (created_at desc);

alter table public.logs enable row level security;

drop policy if exists "logs_select_authenticated" on public.logs;
create policy "logs_select_authenticated"
  on public.logs for select
  to authenticated
  using (true);

-- Insert solo via RPC security definer (niente insert diretto dal client)
drop policy if exists "logs_insert_none" on public.logs;

do $$
begin
  alter publication supabase_realtime add table public.logs;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- RPC: completa TRACE (rivela handle / ID CRIPTATO + log + libera slot actor)
-- =============================================================================
create or replace function public.execute_trace(p_actor_slot_id uuid)
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
  v_revealed text;
  v_target_id uuid;
begin
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

  if v_slot.end_time is not null and v_slot.end_time > timezone('utc', now()) then
    raise exception 'Trace ancora in corso';
  end if;

  v_revealed := 'Unknown';
  v_target_id := null;

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
      if v_target.is_decoy and v_target.user_id is null then
        v_revealed := 'Unknown';
      elsif v_target.user_id is not null then
        select * into v_target_profile
        from public.profiles
        where id = v_target.user_id;

        if found then
          v_target_id := v_target_profile.id;
          if v_target_profile.role = 'ghost' then
            v_revealed := 'ID CRIPTATO';
          else
            v_revealed := v_target_profile.name;
          end if;
        end if;
      end if;
    else
      v_revealed := 'Segnale perso';
    end if;
  end if;

  insert into public.logs (node_id, actor_id, target_id, event_type, message, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'trace',
    format('Trace completato: %s', v_revealed),
    jsonb_build_object(
      'revealed', v_revealed,
      'actor_slot', v_slot.slot_id,
      'target_slot_id', v_slot.target_slot_id
    )
  );

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
  where id = v_slot.id
    and user_id = v_actor;

  update public.profiles
  set status = 'idle'
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'revealed', v_revealed,
    'target_id', v_target_id
  );
end;
$$;

-- =============================================================================
-- RPC: completa KICK (espelle target, is_blocked, log, libera actor)
-- =============================================================================
create or replace function public.execute_kick(p_actor_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_target public.slots%rowtype;
  v_target_id uuid;
  v_target_name text;
begin
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

  if v_slot.end_time is not null and v_slot.end_time > timezone('utc', now()) then
    raise exception 'Kick ancora in corso';
  end if;

  v_target_id := null;
  v_target_name := 'Unknown';

  if v_slot.target_slot_id is not null then
    select * into v_target from public.slots where id = v_slot.target_slot_id;

    if found then
      v_target_id := v_target.user_id;

      -- Libera lo slot bersaglio (azione interrotta)
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
      where id = v_target.id;

      if v_target_id is not null then
        select name into v_target_name from public.profiles where id = v_target_id;

        update public.profiles
        set
          is_blocked = true,
          status = 'idle'
        where id = v_target_id;
      end if;
    end if;
  end if;

  insert into public.logs (node_id, actor_id, target_id, event_type, message, meta)
  values (
    v_slot.node_id,
    v_actor,
    v_target_id,
    'kick',
    format('Kick eseguito su %s', coalesce(v_target_name, 'Unknown')),
    jsonb_build_object(
      'target_slot_id', v_slot.target_slot_id,
      'actor_slot', v_slot.slot_id
    )
  );

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
  where id = v_slot.id
    and user_id = v_actor;

  update public.profiles
  set status = 'idle'
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'target_id', v_target_id,
    'target_name', v_target_name
  );
end;
$$;

grant execute on function public.execute_trace(uuid) to authenticated;
grant execute on function public.execute_kick(uuid) to authenticated;
