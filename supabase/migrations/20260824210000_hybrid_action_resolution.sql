-- =============================================================================
-- ZERO TRUST — phase76: hybrid action resolution
-- Instant client RPC + pg_cron sweeper ogni 30s.
-- Idempotenza: FOR UPDATE sullo slot prima di ICE / crediti / log.
-- Esegui nell'SQL Editor (dopo phase75).
-- =============================================================================

create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Impersonation per il sweeper (auth.uid() legge JWT claims)
-- -----------------------------------------------------------------------------
create or replace function public.zt_impersonate(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    raise exception 'zt_impersonate: uid nullo';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

revoke execute on function public.zt_impersonate(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Rinomina le RPC esistenti a *_unsafe (una volta sola), poi wrapper con lock
-- -----------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- Se una phase precedente ha risostituito il wrapper con il body completo,
  -- scarta la copia _unsafe stantia e rinomina di nuovo.
  if to_regprocedure('public.complete_base_action(uuid, text)') is null then
    raise exception 'complete_base_action(uuid, text) assente';
  end if;
  v_def := pg_get_functiondef('public.complete_base_action(uuid, text)'::regprocedure);
  if v_def not ilike '%complete_base_action_unsafe%' then
    if to_regprocedure('public.complete_base_action_unsafe(uuid, text)') is not null then
      drop function public.complete_base_action_unsafe(uuid, text);
    end if;
    alter function public.complete_base_action(uuid, text)
      rename to complete_base_action_unsafe;
  end if;

  if to_regprocedure('public.execute_trace(uuid, text)') is null then
    raise exception 'execute_trace(uuid, text) assente';
  end if;
  v_def := pg_get_functiondef('public.execute_trace(uuid, text)'::regprocedure);
  if v_def not ilike '%execute_trace_unsafe%' then
    if to_regprocedure('public.execute_trace_unsafe(uuid, text)') is not null then
      drop function public.execute_trace_unsafe(uuid, text);
    end if;
    alter function public.execute_trace(uuid, text)
      rename to execute_trace_unsafe;
  end if;

  if to_regprocedure('public.execute_kick(uuid, text, text)') is null then
    raise exception 'execute_kick(uuid, text, text) assente';
  end if;
  v_def := pg_get_functiondef('public.execute_kick(uuid, text, text)'::regprocedure);
  if v_def not ilike '%execute_kick_unsafe%' then
    if to_regprocedure('public.execute_kick_unsafe(uuid, text, text)') is not null then
      drop function public.execute_kick_unsafe(uuid, text, text);
    end if;
    alter function public.execute_kick(uuid, text, text)
      rename to execute_kick_unsafe;
  end if;
end $$;

revoke execute on function public.complete_base_action_unsafe(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.execute_trace_unsafe(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.execute_kick_unsafe(uuid, text, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- complete_base_action: lock riga slot, poi logica ICE/farm/extract
-- -----------------------------------------------------------------------------
create or replace function public.complete_base_action(
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
  v_slot_id uuid;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select s.id into v_slot_id
  from public.slots s
  where s.id = p_actor_slot_id
    and s.user_id = v_actor
    and s.action_type in ('attack', 'defend', 'farm', 'extract')
  for update;

  if not found then
    raise exception 'Azione base non valida o già completata';
  end if;

  return public.complete_base_action_unsafe(p_actor_slot_id, p_node_name);
end;
$$;

grant execute on function public.complete_base_action(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- execute_trace: lock riga slot, poi reveal / heat / log
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
  v_slot_id uuid;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select s.id into v_slot_id
  from public.slots s
  where s.id = p_actor_slot_id
    and s.user_id = v_actor
    and s.action_type = 'trace'
  for update;

  if not found then
    raise exception 'Trace non valido o già completato';
  end if;

  return public.execute_trace_unsafe(p_actor_slot_id, p_node_name);
end;
$$;

grant execute on function public.execute_trace(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- execute_kick: lock riga slot, poi block / heat / log
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
  v_slot_id uuid;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select s.id into v_slot_id
  from public.slots s
  where s.id = p_actor_slot_id
    and s.user_id = v_actor
    and s.action_type = 'kick'
  for update;

  if not found then
    raise exception 'Kick non valido o già completato';
  end if;

  return public.execute_kick_unsafe(p_actor_slot_id, p_known_handle, p_node_name);
end;
$$;

grant execute on function public.execute_kick(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Sweeper: azioni scadute di TUTTI i giocatori (safety net offline)
-- -----------------------------------------------------------------------------
create or replace function public.resolve_expired_actions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_ok int := 0;
  v_skip int := 0;
  v_fail int := 0;
  v_err text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if not pg_try_advisory_xact_lock(hashtext('zt_resolve_expired_actions')) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  begin
    perform public.zt_sweep_class_effects();
  exception when others then
    null;
  end;

  for r in
    select s.id, s.user_id, s.action_type::text as action_type
    from public.slots s
    where s.user_id is not null
      and coalesce(s.is_decoy, false) is distinct from true
      and s.action_type in ('attack', 'defend', 'farm', 'extract', 'trace', 'kick')
      and s.end_time is not null
      and s.end_time <= timezone('utc', now())
  loop
    begin
      perform public.zt_impersonate(r.user_id);

      if r.action_type in ('attack', 'defend', 'farm', 'extract') then
        perform public.complete_base_action(r.id, null);
      elsif r.action_type = 'trace' then
        perform public.execute_trace(r.id, null);
      elsif r.action_type = 'kick' then
        perform public.execute_kick(r.id, null, null);
      end if;

      v_ok := v_ok + 1;
    exception when others then
      v_err := SQLERRM;
      if v_err ~* 'già completat|non valida|non valido' then
        v_skip := v_skip + 1;
      else
        v_fail := v_fail + 1;
        raise warning 'resolve_expired_actions slot %: %', r.id, v_err;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'resolved', v_ok,
    'already_done', v_skip,
    'failed', v_fail
  );
end;
$$;

revoke execute on function public.resolve_expired_actions() from public, anon;
grant execute on function public.resolve_expired_actions() to authenticated;

-- -----------------------------------------------------------------------------
-- pg_cron: 2 job/minuto → risoluzione ogni ~30s
-- -----------------------------------------------------------------------------
do $$
declare
  jid bigint;
begin
  for jid in
    select jobid
    from cron.job
    where jobname in (
      'sweep-expired-actions-0s',
      'sweep-expired-actions-30s'
    )
  loop
    perform cron.unschedule(jid);
  end loop;
exception when others then
  null;
end $$;

select cron.schedule(
  'sweep-expired-actions-0s',
  '* * * * *',
  $$ select public.resolve_expired_actions(); $$
);

select cron.schedule(
  'sweep-expired-actions-30s',
  '* * * * *',
  $$ select pg_sleep(30); select public.resolve_expired_actions(); $$
);

notify pgrst, 'reload schema';
