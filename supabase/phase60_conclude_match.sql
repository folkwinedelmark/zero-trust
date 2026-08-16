-- =============================================================================
-- ZERO TRUST — phase60: End of match (conclude_match + result snapshot)
-- Esegui nell'SQL Editor (dopo phase59).
--
-- Corp vs Rebel: faction_scores (VP / Core Data).
-- Mercenary: classifica individuale per creds.
-- game_settings.game_state → COMPLETED + match_result jsonb.
-- =============================================================================

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

create or replace function public.conclude_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_state public.game_state_type;
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

  v_actor := public.zt_require_host();

  select game_state into v_state from public.game_settings where id = 1;
  if v_state = 'COMPLETED' then
    select match_result into v_result from public.game_settings where id = 1;
    return coalesce(v_result, jsonb_build_object('ok', true, 'already', true));
  end if;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'La partita non è attiva';
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
    'concluded_at', timezone('utc', now())
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
        'winning_mercenary_id', v_merc_id
      ),
      true
    );
  exception when others then
    raise warning 'conclude_match log failed: %', SQLERRM;
  end;

  return v_result;
end;
$$;

create or replace function public.reset_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_n int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  update public.game_settings
  set
    game_state = 'LOBBY',
    started_at = null,
    scheduled_start_time = null,
    match_duration_days = null,
    winning_faction = null,
    winning_mercenary_id = null,
    match_result = null,
    updated_at = timezone('utc', now())
  where id = 1;

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
    briefing_seen = false,
    status = 'idle'
  where id is not null;

  get diagnostics v_n = row_count;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'lobby_reset',
      '[SYSTEM] Server riportato in Lobby. Fazioni, classi e briefing azzerati.',
      'info',
      jsonb_build_object('tone', 'warning', 'profiles', v_n),
      true
    );
  exception when others then
    raise warning 'reset_lobby log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'profiles', v_n);
end;
$$;

grant execute on function public.conclude_match() to authenticated;
grant execute on function public.reset_lobby() to authenticated;

notify pgrst, 'reload schema';
