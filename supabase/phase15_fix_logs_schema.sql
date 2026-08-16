-- =============================================================================
-- ZERO TRUST — phase15: allinea schema logs (manca `outcome`)
-- Errore console: 42703 / PGRST204  column "outcome" of relation "logs" does not exist
-- La tabella è ferma a phase4 (id, node_id, actor_id, target_id, event_type, message, meta).
-- =============================================================================

-- Colonne attese dal client / RPC (idempotente)
alter table public.logs
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.logs
  add column if not exists outcome text not null default 'info';

alter table public.logs
  add column if not exists is_public boolean not null default false;

comment on column public.logs.outcome is 'success | failure | aborted | info';

grant usage on schema public to authenticated;
grant select, insert on table public.logs to authenticated;

drop policy if exists "logs_insert_own_actor" on public.logs;
create policy "logs_insert_own_actor"
  on public.logs for insert
  to authenticated
  with check (actor_id = auth.uid());

drop function if exists public.zt_write_log(text, text, text, uuid, uuid, jsonb);
drop function if exists public.write_player_log(text, text, text, uuid, uuid, jsonb);

-- Inserisce solo le colonne realmente presenti (outcome → meta se assente)
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
  v_has_outcome boolean;
  v_has_meta boolean;
  v_has_is_public boolean;
  v_meta jsonb;
  v_outcome text;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_outcome := coalesce(nullif(trim(both from coalesce(p_outcome, '')), ''), 'info');
  v_meta := coalesce(p_meta, '{}'::jsonb);

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logs' and column_name = 'outcome'
  ) into v_has_outcome;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logs' and column_name = 'meta'
  ) into v_has_meta;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logs' and column_name = 'is_public'
  ) into v_has_is_public;

  if not v_has_outcome then
    v_meta := v_meta || jsonb_build_object('outcome', v_outcome);
  end if;

  if v_has_outcome and v_has_meta and v_has_is_public then
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      p_node_id, v_actor, p_target_id,
      coalesce(nullif(trim(p_event_type), ''), 'event'),
      coalesce(nullif(p_message, ''), '(vuoto)'),
      v_outcome, v_meta, false
    )
    returning id into v_id;

  elsif v_has_outcome and v_has_meta then
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta
    ) values (
      p_node_id, v_actor, p_target_id,
      coalesce(nullif(trim(p_event_type), ''), 'event'),
      coalesce(nullif(p_message, ''), '(vuoto)'),
      v_outcome, v_meta
    )
    returning id into v_id;

  elsif v_has_meta then
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, meta
    ) values (
      p_node_id, v_actor, p_target_id,
      coalesce(nullif(trim(p_event_type), ''), 'event'),
      coalesce(nullif(p_message, ''), '(vuoto)'),
      v_meta
    )
    returning id into v_id;

  else
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message
    ) values (
      p_node_id, v_actor, p_target_id,
      coalesce(nullif(trim(p_event_type), ''), 'event'),
      coalesce(nullif(p_message, ''), '(vuoto)')
    )
    returning id into v_id;
  end if;

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
