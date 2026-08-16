-- =============================================================================
-- ZERO TRUST — phase55: Weekly abilities = 3 days (alpha playtest)
-- Esegui nell'SQL Editor (dopo phase54).
-- Cooldown long-term: 7 giorni → 3 giorni.
-- =============================================================================

create or replace function public.zt_ability_def(p_ability_id text)
returns table (
  ability_id text,
  required_role public.role_type,
  pa_cost integer,
  cooldown interval
)
language sql
immutable
as $$
  select
    d.ability_id,
    d.required_role,
    d.pa_cost,
    d.cooldown
  from (
    values
      ('hotfix',          'sysadmin'::public.role_type, 1, interval '24 hours'),
      ('kill_process',    'sysadmin',                   1, interval '24 hours'),
      ('hard_reboot',     'sysadmin',                   3, interval '3 days'),
      ('decoy',           'ghost',                      1, interval '24 hours'),
      ('identity_spoof',  'ghost',                      3, interval '3 days'),
      ('deep_scan',       'analyst',                    1, interval '24 hours'),
      ('background_check','analyst',                    1, interval '24 hours'),
      ('doxxing',         'analyst',                    3, interval '3 days'),
      ('immunity',        'executive',                  1, interval '24 hours'),
      ('nda',             'executive',                  1, interval '24 hours'),
      ('asset_freeze',    'executive',                  3, interval '3 days')
  ) as d(ability_id, required_role, pa_cost, cooldown)
  where d.ability_id = p_ability_id;
$$;

notify pgrst, 'reload schema';
