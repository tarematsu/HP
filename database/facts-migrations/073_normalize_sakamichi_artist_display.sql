-- Normalize stored Sakamichi artist metadata once at the data layer. Runtime
-- presentation code and canonical views intentionally perform no fallback or
-- display-time substitution.

UPDATE sh_track_metadata
SET
  artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
    WHEN 'sakurazaka46' THEN '櫻坂46'
    WHEN 'hinatazaka46' THEN '日向坂46'
    WHEN 'nogizaka46' THEN '乃木坂46'
    ELSE artist
  END,
  display_title=CASE
    WHEN title IS NOT NULL AND TRIM(title)<>'' THEN
      TRIM(title) || ' — ' || CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
        WHEN 'sakurazaka46' THEN '櫻坂46'
        WHEN 'hinatazaka46' THEN '日向坂46'
        WHEN 'nogizaka46' THEN '乃木坂46'
        ELSE TRIM(artist)
      END
    ELSE display_title
  END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_track_dictionary
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_isrc_metadata
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_tracks
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');
