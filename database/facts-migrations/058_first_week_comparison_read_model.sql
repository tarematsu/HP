-- Materialize the expensive seven-day first-week comparison scans once.
-- Public Pages reads one compact row per release instead of rescanning
-- sh_minute_facts for every browser/audit request.
CREATE TABLE IF NOT EXISTS sh_first_week_comparison_read_model (
  release_date_jst TEXT PRIMARY KEY,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  point_count INTEGER NOT NULL,
  points_json TEXT NOT NULL CHECK(json_valid(points_json)),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

WITH release_windows(release_date_jst,start_at,end_at) AS (
  VALUES
    ('2024-09-25',unixepoch('2024-09-24 15:00:00')*1000,unixepoch('2024-10-01 15:00:00')*1000),
    ('2025-01-28',unixepoch('2025-01-27 15:00:00')*1000,unixepoch('2025-02-03 15:00:00')*1000),
    ('2025-05-30',unixepoch('2025-05-29 15:00:00')*1000,unixepoch('2025-06-05 15:00:00')*1000),
    ('2025-10-16',unixepoch('2025-10-15 15:00:00')*1000,unixepoch('2025-10-22 15:00:00')*1000),
    ('2026-09-17',unixepoch('2026-09-16 15:00:00')*1000,unixepoch('2026-09-23 15:00:00')*1000)
),
window_rows AS MATERIALIZED (
  SELECT
    r.release_date_jst,r.start_at,r.end_at,
    f.id,f.minute_at,f.observed_at,f.channel_id,f.listener_count,f.source_code,
    f.reported_total_listens AS total_listens,
    f.reported_current_stream_count AS current_stream_count
  FROM release_windows AS r
  JOIN sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_time
    ON f.minute_at>=r.start_at AND f.minute_at<r.end_at
),
channel_stats AS (
  SELECT
    release_date_jst,channel_id,
    COUNT(*) AS sample_count,
    MAX(observed_at) AS max_observed_at
  FROM window_rows
  GROUP BY release_date_jst,channel_id
),
selected_channels AS (
  SELECT release_date_jst,channel_id
  FROM (
    SELECT
      release_date_jst,channel_id,
      ROW_NUMBER() OVER (
        PARTITION BY release_date_jst
        ORDER BY sample_count DESC,max_observed_at DESC,channel_id ASC
      ) AS channel_rank
    FROM channel_stats
  )
  WHERE channel_rank=1
),
normalized AS MATERIALIZED (
  SELECT
    w.release_date_jst,w.start_at,w.id,w.minute_at,w.observed_at,w.listener_count,
    CAST((w.minute_at-w.start_at)/300000 AS INTEGER) AS bucket_index,
    CASE
      WHEN w.source_code IN (3,4)
        THEN CASE WHEN w.total_listens>0 THEN w.total_listens END
      WHEN w.current_stream_count IS NOT NULL
        AND w.current_stream_count>0
        AND w.current_stream_count IS NOT w.total_listens
        THEN w.current_stream_count
      ELSE NULL
    END AS stream_count
  FROM window_rows AS w
  JOIN selected_channels AS s
    ON s.release_date_jst=w.release_date_jst
   AND s.channel_id=w.channel_id
),
buckets AS MATERIALIZED (
  SELECT release_date_jst,bucket_index
  FROM normalized
  GROUP BY release_date_jst,bucket_index
),
listener_ranked AS (
  SELECT
    release_date_jst,bucket_index,observed_at,listener_count,
    ROW_NUMBER() OVER (
      PARTITION BY release_date_jst,bucket_index
      ORDER BY minute_at DESC,id DESC
    ) AS metric_rank
  FROM normalized
  WHERE listener_count IS NOT NULL
),
stream_ranked AS (
  SELECT
    release_date_jst,bucket_index,observed_at,stream_count,
    ROW_NUMBER() OVER (
      PARTITION BY release_date_jst,bucket_index
      ORDER BY minute_at DESC,id DESC
    ) AS metric_rank
  FROM normalized
  WHERE stream_count IS NOT NULL
),
point_rows AS MATERIALIZED (
  SELECT
    b.release_date_jst,
    b.bucket_index*5 AS elapsed_minutes,
    l.listener_count,
    s.stream_count
  FROM buckets AS b
  LEFT JOIN listener_ranked AS l
    ON l.release_date_jst=b.release_date_jst
   AND l.bucket_index=b.bucket_index
   AND l.metric_rank=1
  LEFT JOIN stream_ranked AS s
    ON s.release_date_jst=b.release_date_jst
   AND s.bucket_index=b.bucket_index
   AND s.metric_rank=1
),
aggregated AS (
  SELECT
    r.release_date_jst,
    COUNT(p.elapsed_minutes) AS point_count,
    COALESCE((
      SELECT json_group_array(json(point_json))
      FROM (
        SELECT json_array(
          p2.elapsed_minutes,
          p2.listener_count,
          p2.stream_count
        ) AS point_json
        FROM point_rows AS p2
        WHERE p2.release_date_jst=r.release_date_jst
        ORDER BY p2.elapsed_minutes ASC
      )
    ),'[]') AS points_json
  FROM release_windows AS r
  LEFT JOIN point_rows AS p
    ON p.release_date_jst=r.release_date_jst
  GROUP BY r.release_date_jst
)
INSERT INTO sh_first_week_comparison_read_model(
  release_date_jst,start_at,end_at,point_count,points_json,updated_at
)
SELECT
  r.release_date_jst,r.start_at,r.end_at,
  COALESCE(a.point_count,0),
  COALESCE(a.points_json,'[]'),
  unixepoch()*1000
FROM release_windows AS r
LEFT JOIN aggregated AS a
  ON a.release_date_jst=r.release_date_jst
ON CONFLICT(release_date_jst) DO UPDATE SET
  start_at=excluded.start_at,
  end_at=excluded.end_at,
  point_count=excluded.point_count,
  points_json=excluded.points_json,
  updated_at=excluded.updated_at;
