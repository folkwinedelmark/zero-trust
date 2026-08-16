-- =============================================================================
-- ZERO TRUST — phase49: split audio settings (ui_sound, sfx_sound)
-- Esegui nell'SQL Editor (dopo phase48).
-- =============================================================================

alter table public.profiles
  alter column settings set default
    '{"push_notifications": false, "ui_sound": true, "sfx_sound": true, "music_enabled": true, "music_volume": 0.5}'::jsonb;

update public.profiles
set settings = (
  coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'ui_sound', coalesce(
      (settings ->> 'ui_sound')::boolean,
      coalesce((settings ->> 'sound')::boolean, true)
    ),
    'sfx_sound', coalesce(
      (settings ->> 'sfx_sound')::boolean,
      coalesce((settings ->> 'sound')::boolean, true)
    )
  )
) - 'sound'
where settings is null
   or (settings ? 'sound')
   or not (settings ? 'ui_sound')
   or not (settings ? 'sfx_sound');

comment on column public.profiles.settings is
  'Preferenze client: push_notifications, ui_sound, sfx_sound, music_enabled, music_volume.';
