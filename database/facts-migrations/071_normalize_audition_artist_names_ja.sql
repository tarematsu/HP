-- Normalize Audition artist presentation to Japanese group names.
-- Spotify track: 7I7EkVwXck49MrDL8Aa6fw

UPDATE sh_track_dictionary
SET artist='坂道選抜, 乃木坂46, 櫻坂46, 日向坂46'
WHERE spotify_id='7I7EkVwXck49MrDL8Aa6fw';

UPDATE sh_track_metadata
SET artist='坂道選抜, 乃木坂46, 櫻坂46, 日向坂46',
    display_title=CASE
      WHEN title IS NOT NULL AND TRIM(title)<>''
        THEN TRIM(title) || ' — 坂道選抜, 乃木坂46, 櫻坂46, 日向坂46'
      ELSE display_title
    END
WHERE spotify_id='7I7EkVwXck49MrDL8Aa6fw';

UPDATE sh_tracks
SET artist='坂道選抜, 乃木坂46, 櫻坂46, 日向坂46'
WHERE spotify_id='7I7EkVwXck49MrDL8Aa6fw';

PRAGMA optimize;
