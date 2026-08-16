-- =============================================================================
-- ZERO TRUST — phase28: Trace/Kick solo su azioni core (attack/defend/farm/extract)
-- Esegui nell'SQL Editor (dopo phase27).
-- I cacciatori (trace/kick) non sono bersagliabili: niente stallo a timer speculari.
-- =============================================================================

create or replace function public.zt_is_huntable_action(p_action public.action_type)
returns boolean
language sql
immutable
as $$
  select p_action in ('attack', 'defend', 'farm', 'extract');
$$;

create or replace function public.zt_enforce_huntable_target()
returns trigger
language plpgsql
as $$
declare
  v_target public.slots%rowtype;
  v_action public.action_type;
begin
  if new.action_type is distinct from 'trace'
     and new.action_type is distinct from 'kick' then
    return new;
  end if;

  if new.target_slot_id is null then
    raise exception 'Bersaglio richiesto per Trace/Kick';
  end if;

  select * into v_target
  from public.slots
  where id = new.target_slot_id;

  if not found then
    raise exception 'Bersaglio non trovato';
  end if;

  if v_target.user_id is null and not v_target.is_decoy then
    raise exception 'Bersaglio non occupato';
  end if;

  v_action := v_target.action_type;
  if v_target.is_decoy then
    v_action := coalesce(v_target.action_type, v_target.spoofed_action, 'farm');
  end if;

  if not public.zt_is_huntable_action(v_action) then
    raise exception 'Segnale instabile: il bersaglio non è ancorato a un''azione core.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_slots_huntable_target on public.slots;
create trigger trg_slots_huntable_target
  before insert or update of action_type, target_slot_id
  on public.slots
  for each row
  execute function public.zt_enforce_huntable_target();

grant execute on function public.zt_is_huntable_action(public.action_type) to authenticated;

notify pgrst, 'reload schema';
