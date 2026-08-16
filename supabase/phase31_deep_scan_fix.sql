-- =============================================================================
-- ZERO TRUST — phase31: Deep Scan = turbo-trace (azione, no fazione, log vittima)
-- Esegui nell'SQL Editor (dopo phase30). Idempotente anche se use_ability è ancora
-- la versione phase29: riscrive il messaggio e notifica il bersaglio.
-- =============================================================================

create or replace function public.zt_rewrite_deep_scan_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_revealed text;
  v_node text;
  v_slot text;
begin
  if NEW.event_type is distinct from 'ability' then
    return NEW;
  end if;
  if coalesce(NEW.meta ->> 'ability_id', '') is distinct from 'deep_scan' then
    return NEW;
  end if;

  v_revealed := coalesce(nullif(NEW.meta ->> 'revealed', ''), 'Unknown');
  v_action := nullif(NEW.meta ->> 'target_action', '');
  v_node := coalesce(nullif(NEW.meta ->> 'node_name', ''), 'Server');
  v_slot := coalesce(NEW.meta ->> 'target_slot', NEW.meta ->> 'slot', '?');

  NEW.meta := (coalesce(NEW.meta, '{}'::jsonb) - 'faction')
    || jsonb_build_object('tone', 'info');

  NEW.message := format(
    'Deep Scan: %s — Azione in corso: %s — Server: %s [Slot %s]',
    v_revealed,
    upper(coalesce(v_action, 'UNKNOWN')),
    v_node,
    v_slot
  );

  return NEW;
end;
$$;

drop trigger if exists trg_logs_deep_scan_rewrite on public.logs;
create trigger trg_logs_deep_scan_rewrite
  before insert on public.logs
  for each row
  execute function public.zt_rewrite_deep_scan_log();

create or replace function public.zt_fanout_deep_scan_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.event_type is distinct from 'ability' then
    return NEW;
  end if;
  if coalesce(NEW.meta ->> 'ability_id', '') is distinct from 'deep_scan' then
    return NEW;
  end if;
  if NEW.target_id is null then
    return NEW;
  end if;
  -- Stealth / scan fallito: niente identità né azione compromessa
  if coalesce(NEW.meta ->> 'target_action', '') = '' then
    return NEW;
  end if;

  insert into public.logs (
    node_id, actor_id, target_id, event_type, message, outcome, meta
  ) values (
    NEW.node_id,
    NEW.actor_id,
    NEW.target_id,
    'deep_scan_received',
    'ATTENZIONE: Il tuo nodo ha subito un Deep Scan da un Data Analyst. La tua identità e la tua operazione attuale sono state compromesse.',
    'success',
    jsonb_build_object(
      'tone', 'warning',
      'perspective', 'target',
      'ability_id', 'deep_scan',
      'node_name', NEW.meta ->> 'node_name',
      'slot', NEW.meta ->> 'target_slot',
      'compromised_slot', NEW.meta ->> 'target_slot',
      'compromised_action', NEW.meta ->> 'target_action'
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_logs_deep_scan_victim on public.logs;
create trigger trg_logs_deep_scan_victim
  after insert on public.logs
  for each row
  execute function public.zt_fanout_deep_scan_log();

notify pgrst, 'reload schema';
