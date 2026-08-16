-- =============================================================================
-- ZERO TRUST — phase27: completamento automatico gigs + log trigger
-- Esegui nell'SQL Editor (dopo phase26).
-- Quando un log valida il contratto, escrow e reputation si chiudono da soli.
-- =============================================================================

create or replace function public.zt_gig_apply_complete(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gigs%rowtype;
  v_rep int;
begin
  perform set_config('row_security', 'off', true);

  select * into v_gig
  from public.gigs
  where id = p_gig_id
  for update;

  if not found then
    raise exception 'Gig non trovato';
  end if;

  if v_gig.status = 'COMPLETED' then
    return jsonb_build_object('ok', true, 'status', 'COMPLETED', 'already', true);
  end if;

  if v_gig.status <> 'IN_PROGRESS' then
    raise exception 'Gig non in corso';
  end if;

  if v_gig.deadline is not null and v_gig.deadline <= timezone('utc', now()) then
    perform public.zt_gig_apply_fail(p_gig_id);
    raise exception 'Tempo scaduto: il gig è fallito';
  end if;

  update public.profiles
  set
    creds = creds + v_gig.reward,
    reputation = least(5, reputation + 1)
  where id = v_gig.executor_id
  returning reputation into v_rep;

  update public.gigs
  set status = 'COMPLETED'
  where id = p_gig_id;

  begin
    insert into public.logs (
      actor_id, target_id, event_type, message, outcome, meta
    ) values (
      v_gig.executor_id,
      v_gig.creator_id,
      'gig_complete',
      format(
        'Successo: Gig completato automaticamente — %s — +%s ₵',
        v_gig.description,
        v_gig.reward
      ),
      'success',
      jsonb_build_object(
        'tone', 'success',
        'reward', v_gig.reward,
        'auto', true,
        'gig_id', v_gig.id,
        'target_action', v_gig.target_action
      )
    );
  exception when others then
    raise warning 'gig_complete log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'id', p_gig_id,
    'status', 'COMPLETED',
    'payout', v_gig.reward,
    'reputation', v_rep,
    'verified', true,
    'auto', true
  );
end;
$$;

create or replace function public.gig_complete(p_gig_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_gig public.gigs%rowtype;
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

  return public.zt_gig_apply_complete(p_gig_id);
end;
$$;

-- Sweep: chiude tutti i gigs IN_PROGRESS già dimostrati dai log
create or replace function public.gig_auto_resolve()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gigs%rowtype;
  v_count int := 0;
begin
  perform set_config('row_security', 'off', true);
  perform public.gig_sweep_expired();

  for v_gig in
    select *
    from public.gigs
    where status = 'IN_PROGRESS'
      and accepted_at is not null
      and (deadline is null or deadline > timezone('utc', now()))
    for update skip locked
  loop
    if public.zt_gig_action_verified(v_gig) then
      perform public.zt_gig_apply_complete(v_gig.id);
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'completed', v_count);
end;
$$;

-- Trigger: ogni nuovo log può chiudere il contratto dell'attore
create or replace function public.zt_gig_on_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gigs%rowtype;
begin
  perform set_config('row_security', 'off', true);

  if NEW.actor_id is null then
    return NEW;
  end if;

  if lower(coalesce(NEW.event_type, '')) = 'gig_complete' then
    return NEW;
  end if;

  for v_gig in
    select *
    from public.gigs
    where status = 'IN_PROGRESS'
      and executor_id = NEW.actor_id
      and accepted_at is not null
      and NEW.created_at > accepted_at
      and (deadline is null or deadline > timezone('utc', now()))
    for update skip locked
  loop
    begin
      if public.zt_gig_action_verified(v_gig) then
        perform public.zt_gig_apply_complete(v_gig.id);
      end if;
    exception when others then
      raise warning 'zt_gig_on_log failed for %: %', v_gig.id, SQLERRM;
    end;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_gigs_auto_complete on public.logs;
create trigger trg_gigs_auto_complete
  after insert on public.logs
  for each row
  execute function public.zt_gig_on_log();

revoke execute on function public.zt_gig_apply_complete(uuid) from public, anon, authenticated;
revoke execute on function public.zt_gig_on_log() from public, anon, authenticated;
grant execute on function public.gig_auto_resolve() to authenticated;
grant execute on function public.gig_complete(uuid) to authenticated;

notify pgrst, 'reload schema';
