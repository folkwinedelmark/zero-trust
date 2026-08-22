-- =============================================================================
-- ZERO TRUST — Daily tick automatico (pg_cron)
-- 08:00 Europe/Rome in CEST = 06:00 UTC → cron '0 6 * * *'
-- =============================================================================

create extension if not exists pg_cron;

-- Rimuovi il job se esiste già (idempotente)
do $$
begin
  perform cron.unschedule('daily-tick-zero-trust');
exception when others then
  null;
end $$;

-- Rimuovi i job precedenti (phase40) per evitare doppio tick
do $$
declare
  jid bigint;
begin
  for jid in
    select jobid
    from cron.job
    where jobname in ('daily-tick-zero-trust', 'zt-daily-tick', 'zt_daily_tick')
  loop
    perform cron.unschedule(jid);
  end loop;
exception when others then
  null;
end $$;

select cron.schedule(
  'daily-tick-zero-trust',
  '0 6 * * *',
  $$ select public.simulate_daily_tick(); $$
);
