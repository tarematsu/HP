PRAGMA foreign_keys = ON;

-- Remove stored video links whose final URL dimension segment is smaller than
-- a 1280x720 / 720x1280 equivalent. Rows without parseable dimensions are kept
-- to avoid deleting links we cannot classify from the URL alone.
WITH RECURSIVE
  parts(video_id, rest, segment, segment_index) AS (
    SELECT id, canonical_key || '/', '', 0
      FROM videos
    UNION ALL
    SELECT video_id,
           substr(rest, instr(rest, '/') + 1),
           substr(rest, 1, instr(rest, '/') - 1),
           segment_index + 1
      FROM parts
     WHERE rest <> ''
  ),
  dimensions AS (
    SELECT video_id,
           segment_index,
           CAST(substr(segment, 1, instr(segment, 'x') - 1) AS INTEGER) AS width,
           CAST(substr(segment, instr(segment, 'x') + 1) AS INTEGER) AS height
      FROM parts
     WHERE segment GLOB '[0-9]*x[0-9]*'
       AND segment NOT GLOB '*[^0-9x]*'
       AND (length(segment) - length(replace(segment, 'x', ''))) = 1
       AND instr(segment, 'x') > 1
       AND instr(segment, 'x') < length(segment)
  ),
  final_dimensions AS (
    SELECT video_id, width, height
      FROM dimensions AS dim
     WHERE segment_index = (
       SELECT MAX(segment_index)
         FROM dimensions AS latest
        WHERE latest.video_id = dim.video_id
     )
  )
DELETE FROM videos
 WHERE id IN (
   SELECT video_id
     FROM final_dimensions
    WHERE (CASE WHEN width > height THEN width ELSE height END) < 1280
       OR (CASE WHEN width < height THEN width ELSE height END) < 720
 );

WITH RECURSIVE
  parts(canonical_key, rest, segment, segment_index) AS (
    SELECT canonical_key, canonical_key || '/', '', 0
      FROM video_orientations
    UNION ALL
    SELECT canonical_key,
           substr(rest, instr(rest, '/') + 1),
           substr(rest, 1, instr(rest, '/') - 1),
           segment_index + 1
      FROM parts
     WHERE rest <> ''
  ),
  dimensions AS (
    SELECT canonical_key,
           segment_index,
           CAST(substr(segment, 1, instr(segment, 'x') - 1) AS INTEGER) AS width,
           CAST(substr(segment, instr(segment, 'x') + 1) AS INTEGER) AS height
      FROM parts
     WHERE segment GLOB '[0-9]*x[0-9]*'
       AND segment NOT GLOB '*[^0-9x]*'
       AND (length(segment) - length(replace(segment, 'x', ''))) = 1
       AND instr(segment, 'x') > 1
       AND instr(segment, 'x') < length(segment)
  ),
  final_dimensions AS (
    SELECT canonical_key, width, height
      FROM dimensions AS dim
     WHERE segment_index = (
       SELECT MAX(segment_index)
         FROM dimensions AS latest
        WHERE latest.canonical_key = dim.canonical_key
     )
  )
DELETE FROM video_orientations
 WHERE canonical_key IN (
   SELECT canonical_key
     FROM final_dimensions
    WHERE (CASE WHEN width > height THEN width ELSE height END) < 1280
       OR (CASE WHEN width < height THEN width ELSE height END) < 720
 );
