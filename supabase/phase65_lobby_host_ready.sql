-- =============================================================================
-- ZERO TRUST — phase65: Host lobby + PRONTO persistente
-- Esegui nell'SQL Editor (dopo phase64).
--
-- Primo profilo creato = Host (is_admin). PRONTO (is_ready) resta in DB
-- anche se il client chiude il browser. Non dipende da last_seen.
-- =============================================================================

alter table public.profiles
  add column if not exists is_ready boolean not null default false;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_ready is
  'Lobby: PRONTO persistente fino a toggle o avvio partita.';
comment on column public.profiles.is_admin is
  'Host: primo giocatore in lobby. Controlla avvio / programma partita.';

-- Se manca un host, il profilo più vecchio lo diventa
update public.profiles
set is_admin = true
where id = (
  select id from public.profiles order by created_at asc, id asc limit 1
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

-- Idempotente: non ruba l'host a chi ce l'ha già
create or replace function public.claim_lobby_host()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_host uuid;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select id into v_host
  from public.profiles
  where is_admin = true
  order by created_at asc
  limit 1;

  if v_host is null then
    select id into v_host
    from public.profiles
    order by created_at asc, id asc
    limit 1;

    if v_host is not null then
      update public.profiles
      set is_admin = true
      where id = v_host;
    else
      update public.profiles
      set is_admin = true
      where id = v_actor
      returning id into v_host;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'host_id', v_host,
    'is_host', v_host is not distinct from v_actor
  );
end;
$$;

grant execute on function public.claim_lobby_host() to authenticated;

notify pgrst, 'reload schema';
