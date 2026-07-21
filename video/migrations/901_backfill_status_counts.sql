INSERT INTO status_counts (
  id, active_videos, active_mp4_videos, feed_videos, feed_mp4_videos,
  blocked_videos, death_videos, updated_at
)
WITH active AS (
  SELECT COUNT(*) AS active_videos,
         COALESCE(SUM(media_type = 'mp4'), 0) AS active_mp4_videos
    FROM videos
   WHERE status = 'active'
), feed AS (
  SELECT COUNT(*) AS feed_videos,
         COALESCE(SUM(video.media_type = 'mp4'), 0) AS feed_mp4_videos
    FROM ranking_entries AS ranking
    INNER JOIN videos AS video ON video.id = ranking.video_id
   WHERE ranking.period = '24h'
), blocked AS (
  SELECT COUNT(*) AS blocked_videos FROM video_blocklist
), death AS (
  SELECT COUNT(*) AS death_videos FROM video_death_list
)
SELECT 1,
       active.active_videos,
       active.active_mp4_videos,
       feed.feed_videos,
       feed.feed_mp4_videos,
       blocked.blocked_videos,
       death.death_videos,
       CURRENT_TIMESTAMP
  FROM active CROSS JOIN feed CROSS JOIN blocked CROSS JOIN death
 WHERE true
ON CONFLICT(id) DO UPDATE SET
  active_videos = excluded.active_videos,
  active_mp4_videos = excluded.active_mp4_videos,
  feed_videos = excluded.feed_videos,
  feed_mp4_videos = excluded.feed_mp4_videos,
  blocked_videos = excluded.blocked_videos,
  death_videos = excluded.death_videos,
  updated_at = excluded.updated_at;
