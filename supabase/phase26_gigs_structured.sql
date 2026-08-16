-- =============================================================================
-- ZERO TRUST — phase26: Gigs strutturati + verifica automatica sui logs
-- Esegui nell'SQL Editor (dopo phase25).
-- target_action + target_entity_id; gig_complete controlla i log di sistema.
-- =============================================================================

alter table public.gigs
  add column if not exists target_action text;

alter table public.gigs
  add column if not exists target_entity_id uuid;

alter table public.gigs
  add column if not exists accepted_at timestamptz;

alter table public.gigs drop constraint if exists gigs_target_action_check;
alter table public.gigs
  add constraint gigs_target_action_check
  check (
    target_action is null
    or target_action in ('ATTACK', 'DEFEND', 'KICK', 'TRACE')
  );

create index if not exists gigs_target_entity_idx on public.gigs (target_entity_id);
create index if not exists logs_gig_verify_idx
  on public.logs (actor_id, event_type, created_at);

-- -----------------------------------------------------------------------------
-- Verifica: l'esecutore ha compiuto l'azione sul bersaglio DOPO accepted_at
-- ATTACK/DEFEND → logs.event_type + node_id
-- TRACE/KICK    → logs.event_type + target_id (kick_received come fallback)
-- -----------------------------------------------------------------------------
create or replace function public.zt_gig_action_verified(p_gig public.gigs)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_found boolean := false;
begin
  perform set_config('row_security', 'off', true);

  if p_gig.executor_id is null
     or p_gig.target_action is null
     or p_gig.target_entity_id is null
     or p_gig.accepted_at is null then
    return false;
  end if;

  v_action := lower(p_gig.target_action);

  if v_action in ('attack', 'defend') then
    select exists (
      select 1
      from public.logs l
      where l.actor_id = p_gig.executor_id
        and lower(l.event_type) = v_action
        and l.node_id = p_gig.target_entity_id
        and l.created_at > p_gig.accepted_at
        and coalesce(l.outcome, 'success') in ('success', 'info')
    ) into v_found;
    return coalesce(v_found, false);
  end if;

  if v_action = 'trace' then
    select exists (
      select 1
      from public.logs l
      where l.actor_id = p_gig.executor_id
        and lower(l.event_type) = 'trace'
        and l.target_id = p_gig.target_entity_id
        and l.created_at > p_gig.accepted_at
        and coalesce(l.outcome, 'success') = 'success'
    ) into v_found;
    return coalesce(v_found, false);
  end if;

  if v_action = 'kick' then
    select exists (
      select 1
      from public.logs l
      where l.actor_id = p_gig.executor_id
        and l.created_at > p_gig.accepted_at
        and (
          (
            lower(l.event_type) = 'kick'
            and l.target_id = p_gig.target_entity_id
            and coalesce(l.outcome, 'success') = 'success'
          )
          or (
            lower(l.event_type) = 'kick_received'
            and l.target_id = p_gig.target_entity_id
          )
        )
    ) into v_found;
    return coalesce(v_found, false);
  end if;

  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Crea gig strutturato. description auto-generata (es. "ATTACK on Aegis Prime").
-- -----------------------------------------------------------------------------
drop function if exists public.gig_create(text, integer, integer);

create or replace function public.gig_create(
  p_target_action text,
  p_target_entity_id uuid,
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
  v_action text;
  v_target_name text;
  v_desc text;
  v_id uuid;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_action := upper(trim(both from coalesce(p_target_action, '')));
  if v_action not in ('ATTACK', 'DEFEND', 'KICK', 'TRACE') then
    raise exception 'Azione gig non valida';
  end if;

  if p_target_entity_id is null then
    raise exception 'Bersaglio richiesto';
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

  if v_action in ('ATTACK', 'DEFEND') then
    select n.name into v_target_name
    from public.nodes n
    where n.id = p_target_entity_id
      and n.type = 'server';
    if v_target_name is null then
      raise exception 'Server non valido';
    end if;
  else
    if p_target_entity_id = v_actor then
      raise exception 'Non puoi bersagliare te stesso';
    end if;
    select p.name into v_target_name
    from public.profiles p
    where p.id = p_target_entity_id;
    if v_target_name is null then
      raise exception 'Utente non valido';
    end if;
  end if;

  v_desc := v_action || ' on ' || v_target_name;

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
    creator_id,
    description,
    reward,
    paid_amount,
    status,
    time_limit_seconds,
    target_action,
    target_entity_id
  ) values (
    v_actor,
    v_desc,
    p_reward,
    v_paid,
    'OPEN',
    p_time_limit_seconds,
    v_action,
    p_target_entity_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'status', 'OPEN',
    'reward', p_reward,
    'paid_amount', v_paid,
    'target_action', v_action,
    'target_entity_id', p_target_entity_id,
    'description', v_desc
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Accetta: executor + IN_PROGRESS + deadline + accepted_at
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
  v_accepted timestamptz;
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

  v_accepted := timezone('utc', now());
  v_deadline := v_accepted + make_interval(secs => v_gig.time_limit_seconds);

  update public.gigs
  set
    executor_id = v_actor,
    status = 'IN_PROGRESS',
    deadline = v_deadline,
    accepted_at = v_accepted
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
    'deadline', v_deadline,
    'accepted_at', v_accepted
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Completa SOLO se i log confermano l'azione dopo accepted_at
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

  if not public.zt_gig_action_verified(v_gig) then
    raise exception 'Errore: Azione richiesta non rilevata nei log di sistema.';
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
    'reputation', v_rep,
    'verified', true
  );
end;
$$;

revoke execute on function public.zt_gig_action_verified(public.gigs) from public, anon, authenticated;
grant execute on function public.gig_create(text, uuid, integer, integer) to authenticated;
grant execute on function public.gig_accept(uuid) to authenticated;
grant execute on function public.gig_complete(uuid) to authenticated;

notify pgrst, 'reload schema';
