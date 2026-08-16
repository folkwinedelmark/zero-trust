-- =============================================================================
-- ZERO TRUST — phase14: ripristino log (fix regressione phase13)
-- Esegui nell'SQL Editor.
-- =============================================================================

grant usage on schema public to authenticated;
grant select, insert on table public.logs to authenticated;

drop policy if exists "logs_insert_own_actor" on public.logs;
create policy "logs_insert_own_actor"
  on public.logs for insert
  to authenticated
  with check (actor_id = auth.uid());

-- Firma unica, default sui nullabili: PostgREST matcha anche chiamate parziali
drop function if exists public.zt_write_log(text, text, text, uuid, uuid, jsonb);
drop function if exists public.zt_write_log(text, text, text, uuid, uuid, json);
drop function if exists public.write_player_log(text, text, text, uuid, uuid, jsonb);

create or replace function public.zt_write_log(
  p_event_type text,
  p_message text,
  p_outcome text default 'info',
  p_node_id uuid default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  insert into public.logs (
    node_id, actor_id, target_id, event_type, message, outcome, meta
  ) values (
    p_node_id,
    v_actor,
    p_target_id,
    coalesce(nullif(trim(p_event_type), ''), 'event'),
    coalesce(nullif(p_message, ''), '(vuoto)'),
    coalesce(nullif(trim(p_outcome), ''), 'info'),
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'logged', true, 'id', v_id);
end;
$$;

create or replace function public.write_player_log(
  p_event_type text,
  p_message text,
  p_outcome text default 'info',
  p_node_id uuid default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.zt_write_log(
    p_event_type, p_message, p_outcome, p_node_id, p_target_id, p_meta
  );
end;
$$;

grant execute on function public.zt_write_log(text, text, text, uuid, uuid, jsonb)
  to authenticated, anon, service_role;
grant execute on function public.write_player_log(text, text, text, uuid, uuid, jsonb)
  to authenticated, anon, service_role;

notify pgrst, 'reload schema';
