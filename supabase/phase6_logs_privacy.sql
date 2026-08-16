-- =============================================================================
-- ZERO TRUST — Privacy Log: SELECT solo su actor_id / target_id (+ pubblici)
-- Esegui nell'SQL Editor di Supabase.
-- =============================================================================

-- Eventi di rete pubblici (opzionale, es. broadcast futuri / Intel di mappa)
alter table public.logs
  add column if not exists is_public boolean not null default false;

create index if not exists logs_is_public_idx
  on public.logs (is_public)
  where is_public = true;

-- Rimuovi la policy "tutti i log per autenticati"
drop policy if exists "logs_select_authenticated" on public.logs;
drop policy if exists "logs_select_own_or_public" on public.logs;

-- L'utente legge solo:
--   1) log in cui è attore
--   2) log in cui è bersaglio
--   3) log marcati pubblici (is_public = true)
create policy "logs_select_own_or_public"
  on public.logs for select
  to authenticated
  using (
    actor_id = auth.uid()
    or target_id = auth.uid()
    or is_public = true
  );

-- Insert resta: solo come proprio actor_id (Fase 5)
-- (non tocchiamo logs_insert_own_actor)

comment on policy "logs_select_own_or_public" on public.logs is
  'Privacy: ogni agente vede solo i propri log (actor/target) e gli eventi pubblici.';
