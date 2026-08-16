-- =============================================================================
-- ZERO TRUST — phase56: Victim logs for hostile targeted abilities
-- Esegui nell'SQL Editor (dopo phase55).
-- NDA, Asset Freeze e Doxxing: log personale alla vittima (SECURITY ALERT).
-- =============================================================================

create or replace function public.zt_fanout_hostile_ability_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ability text;
  v_event text;
  v_message text;
begin
  if NEW.event_type is distinct from 'ability' then
    return NEW;
  end if;
  if NEW.target_id is null or NEW.target_id is not distinct from NEW.actor_id then
    return NEW;
  end if;

  v_ability := coalesce(NEW.meta ->> 'ability_id', '');

  if v_ability = 'asset_freeze' then
    v_event := 'asset_freeze_received';
    v_message :=
      'ATTENZIONE: Il tuo conto è stato congelato da un''azione ostile. Non potrai spendere crediti per le prossime 24 ore.';
  elsif v_ability = 'nda' then
    v_event := 'nda_received';
    v_message :=
      'ATTENZIONE: Sei stato colpito da un accordo restrittivo (NDA). La tua operatività sui Contratti (Gigs) è bloccata per le prossime 8 ore.';
  elsif v_ability = 'doxxing' then
    v_event := 'doxxing_received';
    v_message :=
      'SICUREZZA COMPROMESSA: I tuoi log privati delle ultime 24 ore sono stati violati da un Data Analyst tramite Doxxing.';
  else
    return NEW;
  end if;

  insert into public.logs (
    node_id, actor_id, target_id, event_type, message, outcome, meta
  ) values (
    NEW.node_id,
    NEW.actor_id,
    NEW.target_id,
    v_event,
    v_message,
    'success',
    jsonb_build_object(
      'tone', 'danger',
      'tag', 'SECURITY ALERT',
      'perspective', 'target',
      'ability_id', v_ability
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_logs_hostile_ability_victim on public.logs;
create trigger trg_logs_hostile_ability_victim
  after insert on public.logs
  for each row
  execute function public.zt_fanout_hostile_ability_log();

notify pgrst, 'reload schema';
