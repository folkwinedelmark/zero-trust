-- =============================================================================
-- ZERO TRUST — phase59: Asymmetrical class intel (no global reveal)
-- Esegui nell'SQL Editor (dopo phase58).
--
-- La classe NON diventa mai pubblica per uso di abilità o azioni distintive.
-- Trace / Deep Scan / Background Check / Doxxing scrivono class_known
-- solo nella riga privata di player_notes dell'investigatore.
-- =============================================================================

alter table public.player_notes
  add column if not exists class_known boolean not null default false;

comment on column public.player_notes.class_known is
  'True se owner_id ha decifrato la classe di target_user_id (intel privata).';

-- Flag globale: spegni leak già avvenuti. Non viene più scritto dalle RPC.
update public.profiles
set class_revealed = false
where class_revealed is distinct from false;

-- -----------------------------------------------------------------------------
-- Intel privata: UPSERT class_known + log personale [INTEL]
-- -----------------------------------------------------------------------------
create or replace function public.zt_learn_target_class(
  p_owner_id uuid,
  p_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean := false;
begin
  if p_owner_id is null or p_target_id is null then
    return false;
  end if;
  if p_owner_id = p_target_id then
    return false;
  end if;

  begin
    perform set_config('row_security', 'off', true);
  exception when others then
    null;
  end;

  select coalesce(class_known, false)
  into v_already
  from public.player_notes
  where owner_id = p_owner_id
    and target_user_id = p_target_id;

  insert into public.player_notes (
    owner_id, target_user_id, class_known, deduced_faction, updated_at
  ) values (
    p_owner_id, p_target_id, true, 'UNKNOWN', timezone('utc', now())
  )
  on conflict (owner_id, target_user_id) do update
  set
    class_known = true,
    updated_at = timezone('utc', now());

  if coalesce(v_already, false) then
    return false;
  end if;

  begin
    insert into public.logs (
      actor_id, target_id, event_type, message, outcome, meta, is_public
    ) values (
      p_owner_id,
      p_target_id,
      'class_intel',
      '[INTEL] Analisi completata: Classe operativa del bersaglio decifrata e registrata nell''archivio.',
      'info',
      jsonb_build_object(
        'tone', 'info',
        'tag', 'INTEL',
        'perspective', 'actor'
      ),
      false
    );
  exception when others then
    raise warning 'zt_learn_target_class log failed: %', SQLERRM;
  end;

  return true;
end;
$$;

revoke execute on function public.zt_learn_target_class(uuid, uuid)
  from public, anon, authenticated;

-- Nessun reveal globale. Stub per eventuali caller residui.
create or replace function public.zt_reveal_class(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return false;
end;
$$;

-- Abilità di classe: log operazione, MA non rivelare la classe dell'attore
create or replace function public.zt_log_ability(
  p_actor uuid,
  p_ability_id text,
  p_message text,
  p_node_id uuid default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.logs (node_id, actor_id, target_id, event_type, message, outcome, meta)
    values (
      p_node_id,
      p_actor,
      p_target_id,
      'ability',
      p_message,
      'success',
      coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
        'ability_id', p_ability_id,
        'tone', 'info'
      )
    );
  exception when others then
    raise warning 'zt_log_ability failed: %', SQLERRM;
  end;
end;
$$;

-- Trigger slot: non rivelare più la classe per azioni "distintive"
drop trigger if exists trg_slots_reveal_class on public.slots;

create or replace function public.zt_reveal_class_from_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return NEW;
end;
$$;

-- -----------------------------------------------------------------------------
-- Dai log di indagine: intel solo per l'esecutore
-- -----------------------------------------------------------------------------
create or replace function public.zt_intel_from_investigation_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ability text;
  v_occupant uuid;
  v_slot text;
begin
  if NEW.actor_id is null then
    return NEW;
  end if;
  if coalesce(NEW.meta ->> 'perspective', '') = 'target' then
    return NEW;
  end if;
  if NEW.event_type in (
    'class_intel',
    'trace_received',
    'deep_scan_received',
    'doxxing_received'
  ) then
    return NEW;
  end if;

  -- Trace riuscito su uno slot occupato (qualsiasi classe, incluso Ghost)
  if NEW.event_type = 'trace'
     and NEW.outcome = 'success'
     and NEW.target_id is not null then
    perform public.zt_learn_target_class(NEW.actor_id, NEW.target_id);
    return NEW;
  end if;

  if NEW.event_type is distinct from 'ability' then
    return NEW;
  end if;

  v_ability := coalesce(NEW.meta ->> 'ability_id', '');

  if v_ability = 'deep_scan'
     and NEW.target_id is not null
     and coalesce(NEW.meta ->> 'target_action', '') <> '' then
    perform public.zt_learn_target_class(NEW.actor_id, NEW.target_id);

  elsif v_ability = 'doxxing'
     and NEW.target_id is not null then
    perform public.zt_learn_target_class(NEW.actor_id, NEW.target_id);

  elsif v_ability = 'background_check' then
    v_slot := coalesce(NEW.meta ->> 'slot', '');
    if NEW.node_id is not null and v_slot <> '' then
      select s.user_id
      into v_occupant
      from public.slots s
      where s.node_id = NEW.node_id
        and s.slot_id::text = v_slot
        and s.user_id is not null
      limit 1;
      if v_occupant is not null then
        perform public.zt_learn_target_class(NEW.actor_id, v_occupant);
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_logs_class_intel on public.logs;
create trigger trg_logs_class_intel
  after insert on public.logs
  for each row
  execute function public.zt_intel_from_investigation_log();

-- upsert_player_note: non azzerare class_known quando si salvano le note
create or replace function public.upsert_player_note(
  p_target_id uuid,
  p_deduced_faction text default 'UNKNOWN',
  p_custom_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_faction public.deduced_faction_type;
  v_note text;
  v_id uuid;
  v_known boolean := false;
begin
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;
  if p_target_id is null then
    raise exception 'Bersaglio richiesto';
  end if;

  begin
    v_faction := upper(coalesce(nullif(trim(p_deduced_faction), ''), 'UNKNOWN'))::public.deduced_faction_type;
  exception when others then
    v_faction := 'UNKNOWN';
  end;

  v_note := nullif(trim(both from coalesce(p_custom_note, '')), '');
  if v_note is not null and char_length(v_note) > 280 then
    v_note := left(v_note, 280);
  end if;

  insert into public.player_notes (
    owner_id, target_user_id, deduced_faction, custom_note, class_known, updated_at
  ) values (
    v_actor, p_target_id, v_faction, v_note, false, timezone('utc', now())
  )
  on conflict (owner_id, target_user_id) do update
  set
    deduced_faction = excluded.deduced_faction,
    custom_note = excluded.custom_note,
    updated_at = timezone('utc', now())
  returning id, class_known into v_id, v_known;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'deduced_faction', v_faction,
    'custom_note', v_note,
    'class_known', coalesce(v_known, false)
  );
end;
$$;

grant execute on function public.upsert_player_note(uuid, text, text) to authenticated;
revoke execute on function public.zt_reveal_class(uuid) from public, anon, authenticated;
revoke execute on function public.zt_reveal_class_from_slot() from public, anon, authenticated;
revoke execute on function public.zt_intel_from_investigation_log() from public, anon, authenticated;

notify pgrst, 'reload schema';
