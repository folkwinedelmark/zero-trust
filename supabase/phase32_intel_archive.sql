-- =============================================================================
-- ZERO TRUST — phase32: Intel Archive (Background Check / Doxxing persistenti)
-- Esegui nell'SQL Editor (dopo phase31).
-- =============================================================================

do $$
begin
  create type public.intel_target_type as enum ('USER', 'SLOT');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.intel_reports (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references public.profiles (id) on delete cascade,
  ability_id text not null check (ability_id in ('background_check', 'doxxing')),
  target_type public.intel_target_type not null,
  target_name text not null,
  target_id uuid,
  node_id uuid,
  slot text,
  report_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists intel_reports_analyst_created_idx
  on public.intel_reports (analyst_id, created_at desc);

alter table public.intel_reports enable row level security;

drop policy if exists intel_reports_select_own on public.intel_reports;
create policy intel_reports_select_own
  on public.intel_reports for select
  to authenticated
  using (analyst_id = auth.uid());

create or replace function public.zt_save_intel_report(
  p_ability_id text,
  p_target_type text,
  p_target_name text,
  p_report_data jsonb default '[]'::jsonb,
  p_target_id uuid default null,
  p_node_id uuid default null,
  p_slot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_type public.intel_target_type;
  v_name text;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  if p_ability_id not in ('background_check', 'doxxing') then
    raise exception 'Report non archiviabile';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_actor and role = 'analyst'
  ) then
    raise exception 'Solo il Data Analyst può archiviare intel';
  end if;

  v_type := upper(p_target_type)::public.intel_target_type;
  v_name := nullif(trim(both from coalesce(p_target_name, '')), '');
  if v_name is null then
    v_name := case v_type when 'USER' then 'Agente' else 'Slot' end;
  end if;

  insert into public.intel_reports (
    analyst_id,
    ability_id,
    target_type,
    target_name,
    target_id,
    node_id,
    slot,
    report_data
  ) values (
    v_actor,
    p_ability_id,
    v_type,
    v_name,
    p_target_id,
    p_node_id,
    p_slot,
    coalesce(p_report_data, '[]'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'report_id', v_id);
end;
$$;

grant execute on function public.zt_save_intel_report(text, text, text, jsonb, uuid, uuid, text)
  to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.intel_reports;
exception
  when duplicate_object then null;
end
$$;

notify pgrst, 'reload schema';
