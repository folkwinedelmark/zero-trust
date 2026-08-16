-- ZERO TRUST — phase24: Energy Coffee non supera il cap PA (4)
-- Esegui nell'SQL Editor (idempotente).

update public.profiles
set pa = 4
where pa > 4;

alter table public.profiles drop constraint if exists profiles_pa_check;
alter table public.profiles
  add constraint profiles_pa_check check (pa >= 0 and pa <= 4);

create or replace function public.afterlife_helpdesk(p_service text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rep int;
  v_creds int;
  v_blocked boolean;
  v_heat int;
  v_pa int;
  v_base int;
  v_price int;
begin
  perform set_config('row_security', 'off', true);
  if v_actor is null then
    raise exception 'Non autenticato';
  end if;

  v_base := public.zt_item_base_price(p_service);
  if v_base is null or p_service not in ('unlock', 'wipe', 'coffee') then
    raise exception 'Servizio Helpdesk non valido';
  end if;

  select reputation, creds, is_blocked, heat, pa
  into v_rep, v_creds, v_blocked, v_heat, v_pa
  from public.profiles where id = v_actor for update;

  v_price := public.zt_calc_price(v_base, v_rep);

  if p_service = 'unlock' and not v_blocked then
    raise exception 'Account già operativo';
  end if;
  if p_service = 'wipe' and v_heat <= 0 then
    raise exception 'Heat già a zero';
  end if;
  if p_service = 'coffee' and v_pa >= 4 then
    raise exception 'Operazione negata: Hai già i PA al massimo.';
  end if;
  if v_creds < v_price then
    raise exception 'Crediti insufficienti (servono % ₵)', v_price;
  end if;

  if p_service = 'unlock' then
    update public.profiles
    set creds = creds - v_price, is_blocked = false
    where id = v_actor;
  elsif p_service = 'wipe' then
    update public.profiles
    set creds = creds - v_price, heat = 0
    where id = v_actor;
  else
    update public.profiles
    set creds = creds - v_price, pa = least(4, pa + 1)
    where id = v_actor;
  end if;

  return jsonb_build_object('ok', true, 'price', v_price, 'service', p_service);
end;
$$;

grant execute on function public.afterlife_helpdesk(text) to authenticated;

notify pgrst, 'reload schema';
