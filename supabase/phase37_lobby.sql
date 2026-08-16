-- =============================================================================
-- ZERO TRUST — phase37: Pre-Game Lobby, fazioni, avvio partita
-- Esegui nell'SQL Editor (dopo phase36).
--
-- game_settings.game_state: LOBBY | ACTIVE | COMPLETED
-- profiles: faction/role nullable, is_ready, is_admin
-- RPCs: start_game, reset_lobby, select_class
--
-- Installazioni già in corso: game_state parte da ACTIVE per non
-- cacciare i tester in lobby. Usa God Mode → Reset a Stato Lobby.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'game_state_type'
  ) then
    create type public.game_state_type as enum ('LOBBY', 'ACTIVE', 'COMPLETED');
  end if;
end $$;

create table if not exists public.game_settings (
  id integer primary key default 1 check (id = 1),
  game_state public.game_state_type not null default 'LOBBY',
  started_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.game_settings (id, game_state)
values (1, 'ACTIVE')
on conflict (id) do nothing;

alter table public.game_settings enable row level security;

grant select on table public.game_settings to authenticated;

drop policy if exists game_settings_select_authenticated on public.game_settings;
create policy game_settings_select_authenticated
  on public.game_settings for select
  to authenticated
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.game_settings;
exception when duplicate_object then null;
end $$;

alter table public.profiles
  alter column faction drop not null,
  alter column role drop not null;

alter table public.profiles
  add column if not exists is_ready boolean not null default false;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_ready is
  'Lobby: il giocatore ha confermato PRONTO.';
comment on column public.profiles.is_admin is
  'Host / admin: può avviare o resettare la partita.';

update public.profiles
set is_admin = true
where id = (
  select id from public.profiles order by created_at asc limit 1
)
and not exists (
  select 1 from public.profiles p2 where p2.is_admin = true
);

create or replace function public.zt_bootstrap_host()
returns trigger
language plpgsql
as $$
begin
  if NEW.is_admin is distinct from true
     and not exists (
       select 1 from public.profiles where is_admin = true
     ) then
    NEW.is_admin := true;
  end if;
  if NEW.is_ready is null then
    NEW.is_ready := false;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_bootstrap_host on public.profiles;
create trigger trg_profiles_bootstrap_host
  before insert on public.profiles
  for each row
  execute function public.zt_bootstrap_host();

create or replace function public.zt_require_host()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean := false;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select coalesce(is_admin, false) into v_admin
  from public.profiles
  where id = v_actor;

  if not v_admin then
    if exists (select 1 from public.profiles where is_admin = true) then
      raise exception 'Solo l''host può eseguire questa azione';
    end if;
    update public.profiles
    set is_admin = true
    where id = v_actor;
  end if;

  return v_actor;
end;
$$;

create or replace function public.start_game(p_allow_solo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_ids uuid[];
  v_n int := 0;
  v_merc int := 0;
  v_corp int := 0;
  v_rebel int := 0;
  v_i int := 1;
  v_id uuid;
  v_state public.game_state_type;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_actor := public.zt_require_host();

  select game_state into v_state from public.game_settings where id = 1;
  if v_state = 'ACTIVE' then
    raise exception 'La partita è già attiva';
  end if;

  select coalesce(array_agg(id order by random()), '{}')
  into v_ids
  from public.profiles;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 1 then
    raise exception 'Nessun giocatore in lobby';
  end if;
  if v_n < 2 and not coalesce(p_allow_solo, false) then
    raise exception 'Servono almeno 2 giocatori';
  end if;

  if v_n = 1 then
    v_corp := 1;
    v_rebel := 0;
    v_merc := 0;
  elsif v_n <= 4 then
    v_merc := v_n % 2;
    v_corp := (v_n - v_merc + 1) / 2;
    v_rebel := v_n - v_merc - v_corp;
  else
    v_merc := greatest(1, round(v_n * 0.25)::int);
    v_corp := (v_n - v_merc + 1) / 2;
    v_rebel := v_n - v_merc - v_corp;
  end if;

  while v_i <= v_n loop
    v_id := v_ids[v_i];
    if v_i <= v_corp then
      update public.profiles
      set faction = 'security', is_ready = false, role = null
      where id = v_id;
    elsif v_i <= v_corp + v_rebel then
      update public.profiles
      set faction = 'hacktivist', is_ready = false, role = null
      where id = v_id;
    else
      update public.profiles
      set faction = 'consultant', is_ready = false, role = null
      where id = v_id;
    end if;
    v_i := v_i + 1;
  end loop;

  update public.game_settings
  set
    game_state = 'ACTIVE',
    started_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = 1;

  begin
    insert into public.logs (
      node_id, actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      null,
      v_actor,
      null,
      'game_start',
      '[SYSTEM] La guerra corporativa è iniziata. Fazioni assegnate e nodi online.',
      'info',
      jsonb_build_object(
        'tone', 'success',
        'corp', v_corp,
        'rebel', v_rebel,
        'merc', v_merc,
        'players', v_n
      ),
      true
    );
  exception when others then
    raise warning 'start_game log failed: %', SQLERRM;
  end;

  return jsonb_build_object(
    'ok', true,
    'players', v_n,
    'corp', v_corp,
    'rebel', v_rebel,
    'merc', v_merc
  );
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
    updated_at = timezone('utc', now())
  where id = 1;

  update public.profiles
  set
    faction = null,
    role = null,
    is_ready = false,
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
      '[SYSTEM] Server riportato in Lobby. Fazioni e classi azzerate.',
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

create or replace function public.select_class(p_role public.role_type)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_state public.game_state_type;
  v_faction public.faction_type;
  v_corp int := 0;
  v_rebel int := 0;
  v_merc int := 0;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;
  if p_role is null then
    raise exception 'Classe non valida';
  end if;

  select game_state into v_state from public.game_settings where id = 1;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'La partita non è ancora iniziata';
  end if;

  select faction into v_faction from public.profiles where id = v_actor;

  if v_faction is null then
    select
      count(*) filter (where faction = 'security'),
      count(*) filter (where faction = 'hacktivist'),
      count(*) filter (where faction = 'consultant')
    into v_corp, v_rebel, v_merc
    from public.profiles
    where id is not null;

    if v_corp <= v_rebel and v_corp <= v_merc then
      v_faction := 'security';
    elsif v_rebel <= v_merc then
      v_faction := 'hacktivist';
    else
      v_faction := 'consultant';
    end if;
  end if;

  update public.profiles
  set role = p_role, faction = v_faction
  where id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'role', p_role,
    'faction', v_faction
  );
end;
$$;

grant execute on function public.zt_require_host() to authenticated;
grant execute on function public.start_game(boolean) to authenticated;
grant execute on function public.reset_lobby() to authenticated;
grant execute on function public.select_class(public.role_type) to authenticated;

notify pgrst, 'reload schema';
