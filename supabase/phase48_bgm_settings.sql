-- =============================================================================
-- ZERO TRUST — phase48: BGM settings (music_enabled, music_volume)
-- Esegui nell'SQL Editor (dopo phase47).
-- =============================================================================

alter table public.profiles
  alter column settings set default
    '{"push_notifications": false, "sound": true, "music_enabled": true, "music_volume": 0.5}'::jsonb;

update public.profiles
set settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'music_enabled', coalesce((settings ->> 'music_enabled')::boolean, true),
    'music_volume', coalesce((settings ->> 'music_volume')::numeric, 0.5)
  )
where settings is null
   or not (settings ? 'music_enabled')
   or not (settings ? 'music_volume');

comment on column public.profiles.settings is
  'Preferenze client: push_notifications, sound, music_enabled, music_volume.';
