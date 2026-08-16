-- =============================================================================
-- ZERO TRUST — Schema Fase 1 (Users / Nodes / Slots)
-- Esegui nell'SQL Editor di Supabase (tutto in un colpo).
-- =============================================================================

-- Tipi enumerati
create type public.faction_type as enum ('security', 'hacktivist', 'consultant');
create type public.role_type as enum ('sysadmin', 'analyst', 'executive', 'ghost');
create type public.player_status as enum ('idle', 'busy', 'traveling');
create type public.node_type as enum ('server', 'service');
create type public.slot_label as enum ('A', 'B', 'C');
create type public.action_type as enum (
  'attack',
  'defend',
  'farm',
  'extract',
  'trace',
  'kick',
  'deep_scan',
  'decoy',
  'spoof'
);

-- =============================================================================
-- PROFILES (Users del GDD) — 1:1 con auth.users
-- =============================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  faction public.faction_type not null,
  role public.role_type not null,
  creds integer not null default 150 check (creds >= 0),
  pa integer not null default 5 check (pa >= 0 and pa <= 5),
  pa_refreshed_at timestamptz not null default timezone('utc', now()),
  status public.player_status not null default 'idle',
  is_blocked boolean not null default false,
  frozen_until timestamptz,
  buffs text[] not null default '{}',
  cooldowns jsonb not null default '{}'::jsonb,
  -- Posizione attuale sulla mappa (null = non posizionato / appena creato)
  current_node_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_name_length check (char_length(name) between 3 and 24)
);

-- =============================================================================
-- NODES (Server / Servizi)
-- =============================================================================
create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type public.node_type not null,
  -- ICE solo per i server (0–100). Null sui servizi.
  ice integer check (
    (type = 'server' and ice is not null and ice between 0 and 100)
    or (type = 'service' and ice is null)
  ),
  compromised boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add constraint profiles_current_node_id_fkey
  foreign key (current_node_id) references public.nodes (id) on delete set null;

-- =============================================================================
-- SLOTS (3 porte A/B/C per ogni SERVER)
-- =============================================================================
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  slot_id public.slot_label not null,
  user_id uuid references public.profiles (id) on delete set null,
  action_type public.action_type,
  start_time timestamptz,
  end_time timestamptz,
  is_decoy boolean not null default false,
  is_spoofed boolean not null default false,
  -- Usati da Ghost Spoofing: simula un altro utente / azione
  spoofed_as_user_id uuid references public.profiles (id) on delete set null,
  spoofed_action public.action_type,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint slots_unique_per_node unique (node_id, slot_id),
  -- Un giocatore non può occupare più slot contemporaneamente (NULL ammessi più volte)
  constraint slots_one_user_once unique (user_id),
  constraint slots_timer_consistency check (
    (action_type is null and start_time is null and end_time is null)
    or (action_type is not null and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index slots_node_id_idx on public.slots (node_id);
create index slots_user_id_idx on public.slots (user_id);
create index profiles_status_idx on public.profiles (status);

-- FK: solo i server possono avere slot
create or replace function public.enforce_slots_on_servers()
returns trigger
language plpgsql
as $$
declare
  node_kind public.node_type;
begin
  select type into node_kind from public.nodes where id = new.node_id;
  if node_kind is distinct from 'server' then
    raise exception 'Solo i nodi di tipo server possono avere slot';
  end if;
  return new;
end;
$$;

create trigger trg_slots_only_on_servers
  before insert or update of node_id on public.slots
  for each row execute function public.enforce_slots_on_servers();

-- updated_at automatico
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_nodes_updated_at
  before update on public.nodes
  for each row execute function public.set_updated_at();

create trigger trg_slots_updated_at
  before update on public.slots
  for each row execute function public.set_updated_at();

-- =============================================================================
-- SEED: mappa iniziale (3 server + 2 servizi + 9 slot)
-- =============================================================================
with seeded as (
  insert into public.nodes (name, type, ice, compromised)
  values
    ('Aegis Prime', 'server', 75, false),
    ('Helix Core', 'server', 75, false),
    ('Omni Grid', 'server', 75, false),
    ('Bar Afterlife', 'service', null, false),
    ('Helpdesk IT', 'service', null, false)
  returning id, name, type
)
insert into public.slots (node_id, slot_id)
select s.id, label.slot_id
from seeded s
cross join (values ('A'::public.slot_label), ('B'), ('C')) as label(slot_id)
where s.type = 'server';

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.nodes enable row level security;
alter table public.slots enable row level security;

-- Profiles: leggibili da autenticati (Trace/dashboard), scrittura solo sul proprio
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Nodes / Slots: lettura pubblica autenticata (mappa realtime)
create policy "nodes_select_authenticated"
  on public.nodes for select
  to authenticated
  using (true);

-- Fase 2: aggiornamento ICE da azioni base (poi verrà stretto con RPC)
create policy "nodes_update_authenticated"
  on public.nodes for update
  to authenticated
  using (true)
  with check (
    (type = 'server' and ice is not null and ice between 0 and 100)
    or (type = 'service' and ice is null)
  );

create policy "slots_select_authenticated"
  on public.slots for select
  to authenticated
  using (true);

-- Aggiornamento slot: per ora solo il proprio utente (azioni successive via RPC)
create policy "slots_update_own_or_empty"
  on public.slots for update
  to authenticated
  using (user_id is null or user_id = auth.uid())
  with check (user_id is null or user_id = auth.uid());

-- =============================================================================
-- REALTIME (subscription frontend)
-- Idempotente: ignora se la tabella è già in publication
-- =============================================================================
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.nodes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.slots;
exception when duplicate_object then null;
end $$;
