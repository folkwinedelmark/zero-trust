-- =============================================================================
-- ZERO TRUST — phase63: conclude_match (stato globale + chiusura ciclo)
-- Esegui nell'SQL Editor (dopo phase62).
--
-- Adatta lo sketch GDD (match_status / users / CORP|REBEL|MERCENARY) allo schema
-- reale:
--   game_settings.game_state   (LOBBY | SCHEDULED_WAITING | ACTIVE | COMPLETED)
--   profiles                   (GDD Users)
--   faction_type               security=Corp, hacktivist=Rebel, consultant=Merc
--
-- Corp vs Rebel: VP su faction_scores (mai consultant).
-- Mercenary: più ricco per creds.
-- Host può chiudere in qualsiasi momento; a scadenza durata chiunque può triggerare.
-- =============================================================================

create table if not exists public.game_settings (
  id integer primary key default 1 check (id = 1),
  game_state public.game_state_type not null default 'ACTIVE',
  started_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.game_settings (id, game_state)
select 1, 'ACTIVE'
where not exists (select 1 from public.game_settings where id = 1);

alter table public.game_settings
  add column if not exists winning_faction public.faction_type;

alter table public.game_settings
  add column if not exists winning_mercenary_id uuid;

alter table public.game_settings
  add column if not exists match_result jsonb;

comment on column public.game_settings.winning_faction is
  'Vincitore Corp/Rebel (security | hacktivist). NULL = stallo.';
comment on column public.game_settings.winning_mercenary_id is
  'Mercenary con il maggior capitale a fine ciclo.';
comment on column public.game_settings.match_result is
  'Snapshot congelato: VP, podio Merc, draw.';

create or replace function public.zt_match_has_expired(
  p_started_at timestamptz,
  p_duration_days integer
)
returns boolean
language sql
stable
as $$
  select p_started_at is not null
     and p_duration_days is not null
     and p_duration_days > 0
     and timezone('utc', now())
         >= p_started_at + make_interval(days => p_duration_days);
$$;

create or replace function public.conclude_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_state public.game_state_type;
  v_started timestamptz;
  v_days int;
  v_expired boolean := false;
  v_corp int := 0;
  v_rebel int := 0;
  v_winner public.faction_type;
  v_draw boolean := false;
  v_merc_id uuid;
  v_mercs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select coalesce(is_admin, false) into v_admin
  from public.profiles
  where id = v_actor;

  select game_state, started_at, match_duration_days
  into v_state, v_started, v_days
  from public.game_settings
  where id = 1;

  if v_state = 'COMPLETED' then
    select match_result into v_result from public.game_settings where id = 1;
    return coalesce(v_result, jsonb_build_object('ok', true, 'already', true));
  end if;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'La partita non è attiva';
  end if;

  v_expired := public.zt_match_has_expired(v_started, v_days);
  if not coalesce(v_admin, false) and not v_expired then
    raise exception 'Solo l''host può chiudere la partita prima della scadenza';
  end if;

  select coalesce(score, 0) into v_corp
  from public.faction_scores
  where faction = 'security';
  v_corp := coalesce(v_corp, 0);

  select coalesce(score, 0) into v_rebel
  from public.faction_scores
  where faction = 'hacktivist';
  v_rebel := coalesce(v_rebel, 0);

  if v_corp > v_rebel then
    v_winner := 'security';
  elsif v_rebel > v_corp then
    v_winner := 'hacktivist';
  else
    v_winner := null;
    v_draw := true;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.rank), '[]'::jsonb)
  into v_mercs
  from (
    select
      p.id,
      p.name,
      coalesce(p.creds, 0) as creds,
      row_number() over (
        order by coalesce(p.creds, 0) desc, p.name asc
      )::int as rank
    from public.profiles p
    where p.faction = 'consultant'
  ) m;

  select m.id
  into v_merc_id
  from (
    select
      p.id,
      row_number() over (
        order by coalesce(p.creds, 0) desc, p.name asc
      ) as rank
    from public.profiles p
    where p.faction = 'consultant'
  ) m
  where m.rank = 1;

  v_result := jsonb_build_object(
    'ok', true,
    'corp_score', v_corp,
    'rebel_score', v_rebel,
    'winning_faction', v_winner,
    'draw', v_draw,
    'winning_mercenary_id', v_merc_id,
    'mercs', v_mercs,
    'concluded_at', timezone('utc', now()),
    'expired', v_expired
  );

  update public.game_settings
  set
    game_state = 'COMPLETED',
    winning_faction = v_winner,
    winning_mercenary_id = v_merc_id,
    match_result = v_result,
    updated_at = timezone('utc', now())
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'match_end',
      '[SYSTEM] Operazione di rete terminata. Ciclo chiuso. Archiviazione dati finali in corso.',
      'info',
      jsonb_build_object(
        'tone', 'warning',
        'tag', 'SYSTEM',
        'corp_score', v_corp,
        'rebel_score', v_rebel,
        'winning_faction', v_winner,
        'draw', v_draw,
        'winning_mercenary_id', v_merc_id,
        'expired', v_expired
      ),
      true
    );
  exception when others then
    raise warning 'conclude_match log failed: %', SQLERRM;
  end;

  return v_result;
end;
$$;

grant execute on function public.zt_match_has_expired(timestamptz, integer) to authenticated;
grant execute on function public.conclude_match() to authenticated;

notify pgrst, 'reload schema';
