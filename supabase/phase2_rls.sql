-- =============================================================================
-- ZERO TRUST — Fase 2: policy scrittura nodes (ICE)
-- Esegui nell'SQL Editor se hai già applicato schema.sql della Fase 1.
-- =============================================================================

drop policy if exists "nodes_update_authenticated" on public.nodes;

create policy "nodes_update_authenticated"
  on public.nodes for update
  to authenticated
  using (true)
  with check (
    (type = 'server' and ice is not null and ice between 0 and 100)
    or (type = 'service' and ice is null)
  );
