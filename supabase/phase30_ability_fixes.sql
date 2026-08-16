-- =============================================================================
-- ZERO TRUST — phase30: Kill Process log vittima (Fog of War)
-- Esegui nell'SQL Editor (dopo phase29).
-- =============================================================================

create or replace function public.zt_fanout_kill_process_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.event_type is distinct from 'ability' then
    return NEW;
  end if;
  if coalesce(NEW.meta ->> 'ability_id', '') is distinct from 'kill_process' then
    return NEW;
  end if;
  if coalesce(NEW.meta ->> 'result', '') is distinct from 'kicked' then
    return NEW;
  end if;
  if NEW.target_id is null then
    return NEW;
  end if;

  insert into public.logs (
    node_id, actor_id, target_id, event_type, message, outcome, meta
  ) values (
    NEW.node_id,
    NEW.actor_id,
    NEW.target_id,
    'kill_process_received',
    'Sei stato espulso dal server da un SysAdmin tramite l''abilità Kill Process.',
    'success',
    jsonb_build_object(
      'tone', 'danger',
      'perspective', 'target',
      'ability_id', 'kill_process',
      'node_name', NEW.meta ->> 'node_name',
      'slot', NEW.meta ->> 'target_slot',
      'compromised_slot', NEW.meta ->> 'target_slot'
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_logs_kill_process_victim on public.logs;
create trigger trg_logs_kill_process_victim
  after insert on public.logs
  for each row
  execute function public.zt_fanout_kill_process_log();

notify pgrst, 'reload schema';
