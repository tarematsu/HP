const PLAYBACK_PERIOD = '24h';

export function baseLivenessStatusDeltaStatement(db, payload, updatedAt) {
  return db.prepare(
    `WITH input AS (
       SELECT CAST(json_extract(value, '$.id') AS INTEGER) AS id
         FROM json_each(?)
        WHERE json_extract(value, '$.state') = 'dead'
     ), current_state AS (
       SELECT video.id,
              video.media_type AS mediaType,
              (video.status = 'active') AS isActive,
              EXISTS (
                SELECT 1 FROM ranking_entries AS ranking
                 WHERE ranking.period = ?
                   AND ranking.video_id = video.id
              ) AS inFeed
         FROM input
         INNER JOIN videos AS video ON video.id = input.id
     ), delta AS (
       SELECT COUNT(*) AS deadCount,
              COALESCE(SUM(isActive), 0) AS activeCount,
              COALESCE(SUM(isActive AND mediaType = 'mp4'), 0) AS activeMp4Count,
              COALESCE(SUM(inFeed), 0) AS feedCount,
              COALESCE(SUM(inFeed AND mediaType = 'mp4'), 0) AS feedMp4Count
         FROM current_state
     )
     UPDATE status_counts
        SET active_videos = MAX(0, active_videos - (SELECT activeCount FROM delta)),
            active_mp4_videos = MAX(0, active_mp4_videos - (SELECT activeMp4Count FROM delta)),
            feed_videos = MAX(0, feed_videos - (SELECT feedCount FROM delta)),
            feed_mp4_videos = MAX(0, feed_mp4_videos - (SELECT feedMp4Count FROM delta)),
            death_videos = death_videos + (SELECT deadCount FROM delta),
            updated_at = ?
      WHERE id = 1`
  ).bind(payload, PLAYBACK_PERIOD, updatedAt);
}

export function deathLivenessStatusDeltaStatement(db, payload, updatedAt) {
  return db.prepare(
    `WITH input AS (
       SELECT json_extract(value, '$.canonicalKey') AS canonicalKey
         FROM json_each(?)
        WHERE json_extract(value, '$.state') = 'alive'
     ), current_state AS (
       SELECT input.canonicalKey,
              video.media_type AS mediaType,
              (video.status = 'active') AS isActive,
              EXISTS (
                SELECT 1 FROM ranking_entries AS ranking
                 WHERE ranking.period = ?
                   AND ranking.video_id = video.id
              ) AS inFeed
         FROM input
         INNER JOIN videos AS video ON video.canonical_key = input.canonicalKey
     ), delta AS (
       SELECT (SELECT COUNT(*) FROM input) AS revivedCount,
              COALESCE(SUM(isActive), 0) AS activeCount,
              COALESCE(SUM(isActive AND mediaType = 'mp4'), 0) AS activeMp4Count,
              COALESCE(SUM(inFeed), 0) AS feedCount,
              COALESCE(SUM(inFeed AND mediaType = 'mp4'), 0) AS feedMp4Count
         FROM current_state
     )
     UPDATE status_counts
        SET active_videos = active_videos + (SELECT activeCount FROM delta),
            active_mp4_videos = active_mp4_videos + (SELECT activeMp4Count FROM delta),
            feed_videos = feed_videos + (SELECT feedCount FROM delta),
            feed_mp4_videos = feed_mp4_videos + (SELECT feedMp4Count FROM delta),
            death_videos = MAX(0, death_videos - (SELECT revivedCount FROM delta)),
            updated_at = ?
      WHERE id = 1`
  ).bind(payload, PLAYBACK_PERIOD, updatedAt);
}
