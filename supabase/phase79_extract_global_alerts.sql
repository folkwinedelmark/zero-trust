-- =============================================================================
-- ZERO TRUST — phase79: allarme globale su Extract / cambio ownership
-- Esegui nell'SQL Editor (dopo phase78).
--
-- Dopo un Extract riuscito: log pubblico visibile a tutti + push a ogni profilo.
-- Corp/Rebel: il server cade sotto la fazione. Mercenary: Core Data / nodo neutrale.
-- =============================================================================

create or replace function public.zt_broadcast_extract_alert(
  p_node_id uuid,
  p_node_name text,
  p_new_owner public.faction_type,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_faction text;
  v_log text;
  v_push text;
  v_user record;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  v_name := coalesce(nullif(trim(p_node_name), ''), 'Server');

  if p_new_owner is not null and p_new_owner in ('security', 'hacktivist') then
    v_faction := case p_new_owner
      when 'security' then 'Corp'
      when 'hacktivist' then 'Rebel'
      else p_new_owner::text
    end;
    v_log := format(
      '[ALLARME GLOBALE] Il server %s è caduto. L''infrastruttura è ora sotto il controllo della fazione %s.',
      v_name,
      v_faction
    );
    v_push := format(
      'Il server %s è caduto in mano ai %s!',
      v_name,
      v_faction
    );
  else
    v_log := format(
      '[ALLARME GLOBALE] Violazione critica su %s. I Core Data sono stati estratti e il nodo è tornato neutrale.',
      v_name
    );
    v_push := format(
      'Violazione critica su %s. I Core Data sono stati estratti e il nodo è tornato neutrale.',
      v_name
    );
  end if;

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
      p_node_id,
      p_actor_id,
      null,
      'extract_global',
      v_log,
      'warning',
      jsonb_build_object(
        'tone', 'global',
        'tag', 'ALLARME GLOBALE',
        'node_name', v_name,
        'owner_faction', p_new_owner,
        'action_type', 'extract'
      ),
      true
    );
  exception when others then
    raise warning 'zt_broadcast_extract_alert log failed: %', SQLERRM;
  end;

  if to_regprocedure('public.zt_insert_notification(uuid, text, text)') is null then
    return;
  end if;

  for v_user in
    select id
    from public.profiles
    where faction is not null
  loop
    perform public.zt_insert_notification(
      v_user.id,
      'Zero Trust - Allarme Rete',
      v_push
    );
  end loop;
end;
$$;

revoke execute on function public.zt_broadcast_extract_alert(uuid, text, public.faction_type, uuid)
  from public, anon, authenticated;

-- Hook sul wrapper (phase76): dopo Extract riuscito, broadcast globale.
create or replace function public.complete_base_action(
  p_actor_slot_id uuid,
  p_node_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slot_id uuid;
  v_node_id uuid;
  v_result jsonb;
  v_owner public.faction_type;
begin
  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  select s.id, s.node_id into v_slot_id, v_node_id
  from public.slots s
  where s.id = p_actor_slot_id
    and s.user_id = v_actor
    and s.action_type in ('attack', 'defend', 'farm', 'extract')
  for update;

  if not found then
    raise exception 'Azione base non valida o già completata';
  end if;

  v_result := public.complete_base_action_unsafe(p_actor_slot_id, p_node_name);

  if coalesce(v_result->>'action', '') = 'extract'
     and coalesce(v_result->>'outcome', '') = 'success' then
    begin
      v_owner := nullif(v_result->>'owner_faction', '')::public.faction_type;
    exception when others then
      v_owner := null;
    end;
    perform public.zt_broadcast_extract_alert(
      v_node_id,
      coalesce(nullif(v_result->>'node_name', ''), p_node_name, 'Server'),
      v_owner,
      v_actor
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.complete_base_action(uuid, text) to authenticated;

notify pgrst, 'reload schema';
