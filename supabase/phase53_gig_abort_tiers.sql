-- =============================================================================
-- ZERO TRUST — phase53: Tiered Gig abort penalties
-- Esegui nell'SQL Editor (dopo phase52).
-- Abort/fail IN_PROGRESS: Tier A (3–5★) −1 rep no block; Tier B (2★) → 1★ +
-- block; Tier C (1★) resta 1★ + block. Creator abort paga l'escrow all'executor.
-- Ritiro OPEN: nessuna penale, rimborso 100%.
-- =============================================================================

create or replace function public.zt_gig_apply_tiered_penalty(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stars int;
  v_new_rep int;
  v_block boolean;
  v_tier text;
begin
  perform set_config('row_security', 'off', true);

  if p_user_id is null then
    return jsonb_build_object('applied', false);
  end if;

  select reputation into v_stars
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Profilo non trovato';
  end if;

  v_stars := greatest(1, least(5, coalesce(v_stars, 1)));

  if v_stars >= 3 then
    v_new_rep := greatest(1, v_stars - 1);
    v_block := false;
    v_tier := 'A';
  elsif v_stars = 2 then
    v_new_rep := 1;
    v_block := true;
    v_tier := 'B';
  else
    v_new_rep := 1;
    v_block := true;
    v_tier := 'C';
  end if;

  update public.profiles
  set
    reputation = v_new_rep,
    is_blocked = case when v_block then true else is_blocked end
  where id = p_user_id;

  return jsonb_build_object(
    'applied', true,
    'tier', v_tier,
    'stars_before', v_stars,
    'reputation', v_new_rep,
    'blocked', v_block
  );
end;
$$;

drop function if exists public.zt_gig_apply_fail(uuid);
drop function if exists public.zt_gig_apply_fail(uuid, text);
drop function if exists public.zt_gig_apply_fail(uuid, text, text);

-- p_breach_party: 'executor' (default, timeout/abort merc) | 'creator' | 'none'
-- p_reason: 'expired' (default) | 'aborted' | 'cancelled'
create or replace function public.zt_gig_apply_fail(
  p_gig_id uuid,
  p_breach_party text default 'executor',
  p_reason text default 'expired'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gigs%rowtype;
  v_party text := lower(coalesce(nullif(trim(p_breach_party), ''), 'executor'));
  v_reason text := lower(coalesce(nullif(trim(p_reason), ''), 'expired'));
  v_payout_id uuid;
  v_penalized_id uuid;
  v_other_id uuid;
  v_penalty jsonb := jsonb_build_object('applied', false);
  v_personal_msg text;
  v_target_msg text;
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

  if v_party not in ('executor', 'creator', 'none') then
    raise exception 'Parte inadempiente non valida';
  end if;

  if v_party = 'creator' then
    if v_gig.executor_id is null then
      raise exception 'Nessun esecutore a cui versare l''escrow';
    end if;
    v_payout_id := v_gig.executor_id;
    v_penalized_id := v_gig.creator_id;
    v_other_id := v_gig.executor_id;
  elsif v_party = 'executor' and v_gig.executor_id is not null then
    v_payout_id := v_gig.creator_id;
    v_penalized_id := v_gig.executor_id;
    v_other_id := v_gig.creator_id;
  else
    v_payout_id := v_gig.creator_id;
    v_penalized_id := null;
    v_other_id := null;
    v_party := 'none';
  end if;

  update public.profiles
  set creds = creds + v_gig.paid_amount
  where id = v_payout_id;

  if v_penalized_id is not null then
    v_penalty := public.zt_gig_apply_tiered_penalty(v_penalized_id);
  end if;

  update public.gigs
  set status = 'FAILED'
  where id = p_gig_id;

  if v_reason = 'cancelled' then
    v_personal_msg := format(
      '[GIGS] Contratto ritirato: escrow rimborsato (%s ₵).',
      v_gig.paid_amount
    );
  elsif v_reason = 'aborted' then
    v_personal_msg := '[GIGS] Contratto annullato: applicata penale reputazione.';
  else
    v_personal_msg := '[GIGS] Contratto scaduto: applicata penale reputazione.';
  end if;

  if v_party = 'creator' then
    v_target_msg := format(
      '[GIGS] Contratto annullato: ricevuto compenso di %s ₵ per inadempienza del committente.',
      v_gig.paid_amount
    );
  elsif v_reason = 'aborted' then
    v_target_msg := format(
      '[GIGS] Contratto annullato: escrow rimborsato (%s ₵).',
      v_gig.paid_amount
    );
  elsif v_reason = 'expired' and v_other_id is not null then
    v_target_msg := format(
      '[GIGS] Contratto scaduto: escrow rimborsato (%s ₵).',
      v_gig.paid_amount
    );
  else
    v_target_msg := null;
  end if;

  begin
    insert into public.logs (
      actor_id, target_id, event_type, message, outcome, meta
    ) values (
      coalesce(v_penalized_id, v_gig.creator_id),
      null,
      case
        when v_reason = 'cancelled' then 'gig_cancel'
        when v_reason = 'aborted' then 'gig_fail'
        else 'gig_fail'
      end,
      v_personal_msg,
      case when v_penalized_id is not null then 'fail' else 'info' end,
      jsonb_build_object(
        'tone', case when v_penalized_id is not null then 'danger' else 'info' end,
        'gig_id', v_gig.id,
        'reason', v_reason,
        'paid_amount', v_gig.paid_amount,
        'penalty', v_penalty
      )
    );
  exception when others then
    raise warning 'gig fail personal log failed: %', SQLERRM;
  end;

  if v_other_id is not null and v_target_msg is not null then
    begin
      insert into public.logs (
        actor_id, target_id, event_type, message, outcome, meta
      ) values (
        coalesce(v_penalized_id, v_gig.creator_id),
        v_other_id,
        'gig_fail',
        v_target_msg,
        'info',
        jsonb_build_object(
          'tone', 'warning',
          'perspective', 'target',
          'gig_id', v_gig.id,
          'reason', v_reason,
          'paid_amount', v_gig.paid_amount
        )
      );
    exception when others then
      raise warning 'gig fail target log failed: %', SQLERRM;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'FAILED',
    'reason', v_reason,
    'refunded', case when v_payout_id = v_gig.creator_id then v_gig.paid_amount else 0 end,
    'payout', case when v_payout_id is distinct from v_gig.creator_id then v_gig.paid_amount else 0 end,
    'payout_id', v_payout_id,
    'blocked', coalesce((v_penalty->>'blocked')::boolean, false),
    'penalty', v_penalty
  );
end;
$$;

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
    v_result := public.zt_gig_apply_fail(p_gig_id, 'none', 'cancelled');
    return v_result || jsonb_build_object('reason', 'cancelled');
  end if;

  if v_gig.status <> 'IN_PROGRESS' then
    raise exception 'Gig non in corso';
  end if;

  if v_gig.executor_id is not distinct from v_actor then
    v_result := public.zt_gig_apply_fail(p_gig_id, 'executor', 'aborted');
    return v_result || jsonb_build_object('reason', 'aborted', 'party', 'executor');
  end if;

  if v_gig.creator_id is not distinct from v_actor then
    v_result := public.zt_gig_apply_fail(p_gig_id, 'creator', 'aborted');
    return v_result || jsonb_build_object('reason', 'aborted', 'party', 'creator');
  end if;

  raise exception 'Solo le parti del contratto possono abortire un gig in corso';
end;
$$;

revoke execute on function public.zt_gig_apply_tiered_penalty(uuid) from public, anon, authenticated;
revoke execute on function public.zt_gig_apply_fail(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gig_abort(uuid) to authenticated;

notify pgrst, 'reload schema';
