-- =============================================================================
-- ZERO TRUST — phase66: reset_lobby svuota i log della partita precedente
-- Esegui nell'SQL Editor (dopo phase65).
-- =============================================================================

create or replace function public.reset_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_n int := 0;
  v_logs int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  delete from public.logs where id is not null;
  get diagnostics v_logs = row_count;

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
      '[SYSTEM] Server riportato in Lobby. Log del ciclo precedente azzerati.',
      'info',
      jsonb_build_object('tone', 'warning', 'profiles', v_n, 'logs_deleted', v_logs),
      true
    );
  exception when others then
    raise warning 'reset_lobby log failed: %', SQLERRM;
  end;

  return jsonb_build_object('ok', true, 'profiles', v_n, 'logs_deleted', v_logs);
end;
$$;

grant execute on function public.reset_lobby() to authenticated;

notify pgrst, 'reload schema';
