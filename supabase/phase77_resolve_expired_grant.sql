-- =============================================================================
-- ZERO TRUST — phase77: resolve_expired_actions eseguibile da authenticated
-- Heartbeat 10s + observer ping. Cron 30s invariato.
-- Esegui nell'SQL Editor (dopo phase76). Idempotente.
-- =============================================================================

-- Già SECURITY DEFINER + row_security off in phase76.
grant execute on function public.resolve_expired_actions() to authenticated;

notify pgrst, 'reload schema';
