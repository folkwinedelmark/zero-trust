-- =============================================================================
-- ZERO TRUST — phase25: Mercenary Gigs (contratti / escrow / reputation)
-- Esegui nell'SQL Editor (dopo phase24).
-- profiles = Users del GDD. Escrow atomico via RPC security definer.
-- =============================================================================

create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  executor_id uuid references public.profiles (id) on delete set null,
  description text not null,
  reward integer not null,
  paid_amount integer not null,
  status text not null default 'OPEN',
  time_limit_seconds integer not null,
  deadline timestamptz,
  constraint gigs_description_len check (char_length(trim(description)) between 3 and 200),
  constraint gigs_reward_positive check (reward > 0),
  constraint gigs_paid_positive check (paid_amount > 0),
  constraint gigs_status_check check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  constraint gigs_time_limit_range check (time_limit_seconds between 60 and 86400),
  constraint gigs_executor_not_creator check (executor_id is null or executor_id <> creator_id),
  constraint gigs_open_has_no_executor check (
    (status = 'OPEN' and executor_id is null and deadline is null)
    or status <> 'OPEN'
  ),
  constraint gigs_progress_has_executor check (
    (status = 'IN_PROGRESS' and executor_id is not null and deadline is not null)
    or status <> 'IN_PROGRESS'
  )
);

create index if not exists gigs_status_idx on public.gigs (status);
create index if not exists gigs_creator_id_idx on public.gigs (creator_id);
create index if not exists gigs_executor_id_idx on public.gigs (executor_id);
create index if not exists gigs_deadline_idx on public.gigs (deadline)
  where status = 'IN_PROGRESS';

alter table public.gigs enable row level security;

grant select on table public.gigs to authenticated;

drop policy if exists "gigs_select_open_or_party" on public.gigs;
create policy "gigs_select_open_or_party"
  on public.gigs for select
  to authenticated
  using (
    status = 'OPEN'
    or creator_id = auth.uid()
    or executor_id = auth.uid()
  );

-- Nessun insert/update/delete diretto: escrow solo via RPC
drop policy if exists "gigs_insert_none" on public.gigs;
drop policy if exists "gigs_update_none" on public.gigs;
drop policy if exists "gigs_delete_none" on public.gigs;

do $$
begin
  alter publication supabase_realtime add table public.gigs;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Costo di pubblicazione (Executive: −25%, GDD §6)
-- -----------------------------------------------------------------------------
create or replace function public.zt_gig_create_cost(p_reward integer, p_role public.role_type)
returns integer
language sql
immutable
as $$
  select greatest(1, case
    when p_role = 'executive' then round(p_reward * 0.75)::integer
    else p_reward
  end);
$$;

-- -----------------------------------------------------------------------------
-- Fallimento: rimborso escrow al creator. Se c'è un executor, block + −1 rep.
-- -----------------------------------------------------------------------------
create or replace function public.zt_gig_apply_fail(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gigs%rowtype;
begin
  perform set_config('row_security', 'off', true);

  select * into v_gig
  from public.gigs
  where id = p_gig_id
  for update;

  if not found then
    raise exception 'Gig non trovato';
  end if;

  if v_gig.status in ('COMPLETED', 'FAILED') then
    return jsonb_build_object('ok', true, 'status', v_gig.status, 'already', true);
  end if;

  update public.profiles
  set creds = creds + v_gig.paid_amount
  where id = v_gig.creator_id;

  if v_gig.executor_id is not null then
    update public.profiles
    set
      is_blocked = true,
      reputation = greatest(1, reputation - 1)
    where id = v_gig.executor_id;
  end if;

  update public.gigs
  set status = 'FAILED'
  where id = p_gig_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'FAILED',
    'refunded', v_gig.paid_amount,
    'blocked', v_gig.executor_id is not null
  );
end;
$$;

-- Scadenza automatica dei contratti IN_PROGRESS oltre deadline
create or replace function public.gig_sweep_expired()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  perform set_config('row_security', 'off', true);

  for v_id in
    select id
    from public.gigs
    where status = 'IN_PROGRESS'
      and deadline is not null
      and deadline <= timezone('utc', now())
    for update skip locked
  loop
    perform public.zt_gig_apply_fail(v_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'expired', v_count);
end;
$$;

-- -----------------------------------------------------------------------------
-- Crea gig: scala subito i crediti (escrow). Status OPEN.
-- -----------------------------------------------------------------------------
create or replace function public.gig_create(
  p_description text,
  p_reward integer,
  p_time_limit_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.role_type;
  v_creds int;
  v_blocked boolean;
  v_paid int;
  v_desc text;
  v_id uuid;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_desc := trim(both from coalesce(p_description, ''));
  if char_length(v_desc) < 3 or char_length(v_desc) > 200 then
    raise exception 'Descrizione non valida (3–200 caratteri)';
  end if;

  if p_reward is null or p_reward < 10 then
    raise exception 'Ricompensa minima: 10 ₵';
  end if;
  if p_reward > 5000 then
    raise exception 'Ricompensa massima: 5000 ₵';
  end if;

  if p_time_limit_seconds is null
     or p_time_limit_seconds < 60
     or p_time_limit_seconds > 86400 then
    raise exception 'Tempo limite non valido (1 min – 24 ore)';
  end if;

  select role, creds, is_blocked
  into v_role, v_creds, v_blocked
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;

  if v_blocked then
    raise exception 'Account BLOCKED: non puoi pubblicare gigs';
  end if;

  v_paid := public.zt_gig_create_cost(p_reward, v_role);

  if v_creds < v_paid then
    raise exception 'Crediti insufficienti (servono % ₵ in escrow)', v_paid;
  end if;

  update public.profiles
  set creds = creds - v_paid
  where id = v_actor;

  insert into public.gigs (
    creator_id, description, reward, paid_amount, status, time_limit_seconds
  ) values (
    v_actor, v_desc, p_reward, v_paid, 'OPEN', p_time_limit_seconds
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'status', 'OPEN',
    'reward', p_reward,
    'paid_amount', v_paid
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Accetta gig: diventa IN_PROGRESS, sparisce dalla board pubblica.
-- deadline = now + time_limit (finestra per completare).
-- -----------------------------------------------------------------------------
create or replace function public.gig_accept(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_gig public.gigs%rowtype;
  v_blocked boolean;
  v_deadline timestamptz;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  if p_gig_id is null then
    raise exception 'Gig non valido';
  end if;

  select * into v_gig
  from public.gigs
  where id = p_gig_id
  for update;

  if not found then
    raise exception 'Gig non trovato';
  end if;

  if v_gig.status <> 'OPEN' then
    raise exception 'Gig non più disponibile';
  end if;

  if v_gig.creator_id = v_actor then
    raise exception 'Non puoi accettare un tuo gig';
  end if;

  select is_blocked into v_blocked
  from public.profiles
  where id = v_actor
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;

  if v_blocked then
    raise exception 'Account BLOCKED: non puoi accettare gigs';
  end if;

  v_deadline := timezone('utc', now()) + make_interval(secs => v_gig.time_limit_seconds);

  update public.gigs
  set
    executor_id = v_actor,
    status = 'IN_PROGRESS',
    deadline = v_deadline
  where id = p_gig_id
    and status = 'OPEN'
    and executor_id is null;

  if not found then
    raise exception 'Gig già accettato da un altro mercenario';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', p_gig_id,
    'status', 'IN_PROGRESS',
    'deadline', v_deadline
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Completa: escrow → executor, +1 reputation (max 5). Solo prima della deadline.
-- -----------------------------------------------------------------------------
create or replace function public.gig_complete(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_gig public.gigs%rowtype;
  v_rep int;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select * into v_gig
  from public.gigs
  where id = p_gig_id
  for update;

  if not found then
    raise exception 'Gig non trovato';
  end if;

  if v_gig.status = 'FAILED' then
    raise exception 'Tempo scaduto: il gig è fallito';
  end if;

  if v_gig.status <> 'IN_PROGRESS' then
    raise exception 'Gig non in corso';
  end if;

  if v_gig.executor_id is distinct from v_actor then
    raise exception 'Solo l''esecutore può validare il gig';
  end if;

  if v_gig.deadline is not null and v_gig.deadline <= timezone('utc', now()) then
    perform public.zt_gig_apply_fail(p_gig_id);
    raise exception 'Tempo scaduto: il gig è fallito';
  end if;

  update public.profiles
  set
    creds = creds + v_gig.reward,
    reputation = least(5, reputation + 1)
  where id = v_actor
  returning reputation into v_rep;

  update public.gigs
  set status = 'COMPLETED'
  where id = p_gig_id;

  return jsonb_build_object(
    'ok', true,
    'id', p_gig_id,
    'status', 'COMPLETED',
    'payout', v_gig.reward,
    'reputation', v_rep
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Abort / fail:
--   creator + OPEN        → rimborso, FAILED (nessuna penalità)
--   executor + IN_PROGRESS → rimborso creator, block + −1 rep
-- -----------------------------------------------------------------------------
create or replace function public.gig_abort(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_gig public.gigs%rowtype;
  v_result jsonb;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select * into v_gig
  from public.gigs
  where id = p_gig_id
  for update;

  if not found then
    raise exception 'Gig non trovato';
  end if;

  if v_gig.status in ('COMPLETED', 'FAILED') then
    raise exception 'Gig già chiuso';
  end if;

  if v_gig.status = 'OPEN' then
    if v_gig.creator_id is distinct from v_actor then
      raise exception 'Solo il creatore può ritirare un gig aperto';
    end if;
    v_result := public.zt_gig_apply_fail(p_gig_id);
    return v_result || jsonb_build_object('reason', 'cancelled');
  end if;

  if v_gig.executor_id is distinct from v_actor then
    raise exception 'Solo l''esecutore può abortire un gig in corso';
  end if;

  v_result := public.zt_gig_apply_fail(p_gig_id);
  return v_result || jsonb_build_object('reason', 'aborted');
end;
$$;

revoke execute on function public.zt_gig_apply_fail(uuid) from public, anon, authenticated;
grant execute on function public.zt_gig_create_cost(integer, public.role_type) to authenticated;
grant execute on function public.gig_sweep_expired() to authenticated;
grant execute on function public.gig_create(text, integer, integer) to authenticated;
grant execute on function public.gig_accept(uuid) to authenticated;
grant execute on function public.gig_complete(uuid) to authenticated;
grant execute on function public.gig_abort(uuid) to authenticated;

notify pgrst, 'reload schema';
