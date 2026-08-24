-- =============================================================================
-- ZERO TRUST — phase78: allarme intrusione anche sui server Mercenary
-- Esegui nell'SQL Editor (dopo phase77).
--
-- Prima: solo owner_faction in (security, hacktivist).
-- Ora: qualsiasi owner_faction non NULL, incluso consultant (Mercenary).
-- =============================================================================

create or replace function public.zt_notify_intrusion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.faction_type;
  v_name text;
  v_member record;
  v_body text;
begin
  if NEW.user_id is null then
    return NEW;
  end if;
  if NEW.action_type is distinct from 'attack'
     and NEW.action_type is distinct from 'extract' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.user_id is not distinct from NEW.user_id
     and OLD.action_type is not distinct from NEW.action_type
     and OLD.start_time is not distinct from NEW.start_time then
    return NEW;
  end if;

  select owner_faction, name
  into v_owner, v_name
  from public.nodes
  where id = NEW.node_id;

  -- Qualsiasi fazione proprietaria (Corp, Rebel, Mercenary). Neutrali = niente alert.
  if v_owner is null then
    return NEW;
  end if;

  v_name := coalesce(nullif(trim(v_name), ''), 'Server');
  v_body := format(
    '[ALLARME INTRUSIONE] Rilevato traffico ostile sul server %s. Richiesto intervento di sicurezza immediato.',
    v_name
  );

  for v_member in
    select id
    from public.profiles
    where faction = v_owner
      and id is distinct from NEW.user_id
  loop
    perform public.zt_insert_notification(
      v_member.id,
      '[ALLARME INTRUSIONE]',
      format(
        'Rilevato traffico ostile sul server %s. Richiesto intervento di sicurezza immediato.',
        v_name
      )
    );

    begin
      insert into public.logs (
        node_id,
        actor_id,
        target_id,
        event_type,
        message,
        outcome,
        meta,
        is_public
      ) values (
        NEW.node_id,
        NEW.user_id,
        v_member.id,
        'intrusion_alert',
        v_body,
        'warning',
        jsonb_build_object(
          'tone', 'danger',
          'tag', 'ALLARME',
          'perspective', 'target',
          'node_name', v_name,
          'action_type', NEW.action_type,
          'slot', NEW.slot_id::text
        ),
        false
      );
    exception when others then
      raise warning 'zt_notify_intrusion log failed: %', SQLERRM;
    end;
  end loop;

  return NEW;
end;
$$;

notify pgrst, 'reload schema';
