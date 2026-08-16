-- =============================================================================
-- ZERO TRUST — phase13: log RPC affidabile (completion / abort)
-- Esegui nell'SQL Editor. Una sola firma, niente default/overload.
-- =============================================================================

-- Privilegi tabella (senza GRANT l'INSERT client fallisce anche con policy RLS)
grant select, insert on table public.logs to authenticated;

drop policy if exists "logs_insert_own_actor" on public.logs;
create policy "logs_insert_own_actor"
  on public.logs for insert
  to authenticated
  with check (actor_id = auth.uid());

drop function if exists public.write_player_log(text, text, text, uuid, uuid, jsonb);
drop function if exists public.zt_write_log(text, text, text, uuid, uuid, jsonb);

-- RPC security definer: bypassa RLS. Tutti gli argomenti obbligatori
-- (null ammessi su uuid/jsonb) così PostgREST non sbaglia firma.
create or replace function public.zt_write_log(
  p_event_type text,
  p_message text,
  p_outcome text,
  p_node_id uuid,
  p_target_id uuid,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_outcome text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'event_type richiesto';
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'message richiesto';
  end if;

  v_outcome := coalesce(nullif(trim(both from coalesce(p_outcome, '')), ''), 'info');

  insert into public.logs (
    node_id, actor_id, target_id, event_type, message, outcome, meta
  ) values (
    p_node_id,
    v_actor,
    p_target_id,
    trim(p_event_type),
    p_message,
    v_outcome,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'logged', true, 'id', v_id);
end;
$$;

-- Alias con lo stesso contratto (il client prova entrambi)
create or replace function public.write_player_log(
  p_event_type text,
  p_message text,
  p_outcome text,
  p_node_id uuid,
  p_target_id uuid,
  p_meta jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.zt_write_log(
    p_event_type, p_message, p_outcome, p_node_id, p_target_id, p_meta
  );
$$;

grant execute on function public.zt_write_log(text, text, text, uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.write_player_log(text, text, text, uuid, uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
