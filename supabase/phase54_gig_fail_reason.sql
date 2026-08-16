-- =============================================================================
-- ZERO TRUST — phase54: Gig fail_reason (Storico)
-- Esegui nell'SQL Editor (dopo phase53).
-- Traccia perché un contratto è FAILED: abort Merc/Client, timeout, ritiro.
-- =============================================================================

alter table public.gigs
  add column if not exists fail_reason text;

alter table public.gigs drop constraint if exists gigs_fail_reason_check;
alter table public.gigs
  add constraint gigs_fail_reason_check
  check (
    fail_reason is null
    or fail_reason in (
      'Annullato dal Merc',
      'Annullato dal Client',
      'Tempo Scaduto',
      'Ritirato'
    )
  );

create or replace function public.zt_gig_fail_reason_label(
  p_party text,
  p_reason text
)
returns text
language sql
immutable
as $$
  select case
    when p_reason = 'cancelled' then 'Ritirato'
    when p_reason = 'expired' then 'Tempo Scaduto'
    when p_party = 'creator' then 'Annullato dal Client'
    when p_party = 'executor' then 'Annullato dal Merc'
    else null
  end;
$$;

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
  v_fail_reason text;
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
    return jsonb_build_object(
      'ok', true,
      'status', v_gig.status,
      'already', true,
      'fail_reason', v_gig.fail_reason
    );
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

  v_fail_reason := public.zt_gig_fail_reason_label(v_party, v_reason);

  update public.profiles
  set creds = creds + v_gig.paid_amount
  where id = v_payout_id;

  if v_penalized_id is not null then
    v_penalty := public.zt_gig_apply_tiered_penalty(v_penalized_id);
  end if;

  update public.gigs
  set
    status = 'FAILED',
    fail_reason = v_fail_reason
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
        else 'gig_fail'
      end,
      v_personal_msg,
      case when v_penalized_id is not null then 'fail' else 'info' end,
      jsonb_build_object(
        'tone', case when v_penalized_id is not null then 'danger' else 'info' end,
        'gig_id', v_gig.id,
        'reason', v_reason,
        'fail_reason', v_fail_reason,
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
          'fail_reason', v_fail_reason,
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
    'fail_reason', v_fail_reason,
    'refunded', case when v_payout_id = v_gig.creator_id then v_gig.paid_amount else 0 end,
    'payout', case when v_payout_id is distinct from v_gig.creator_id then v_gig.paid_amount else 0 end,
    'payout_id', v_payout_id,
    'blocked', coalesce((v_penalty->>'blocked')::boolean, false),
    'penalty', v_penalty
  );
end;
$$;

revoke execute on function public.zt_gig_fail_reason_label(text, text) from public, anon, authenticated;
revoke execute on function public.zt_gig_apply_fail(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
