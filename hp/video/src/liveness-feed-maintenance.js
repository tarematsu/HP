import { recentFeedCutoff } from './source-feed-time.js';

const PLAYBACK_PERIOD = '24h';

export function restoreRevivedRankingStatement(db, payload, checkedAt) {
  const cutoffAt = recentFeedCutoff(checkedAt);
  return db.prepare(
    `INSERT OR IGNORE INTO ranking_entries (period, video_id, rank, captured_at)
     SELECT ?, video.id, -video.id, ?
       FROM json_each(?) AS input
       INNER JOIN videos AS video
         ON video.canonical_key = json_extract(input.value, '$.canonicalKey')
      WHERE json_extract(input.value, '$.state') = 'alive'
        AND video.status = 'active'
        AND video.last_seen_at >= ?
        AND NOT EXISTS (
          SELECT 1 FROM video_blocklist AS bad
           WHERE bad.canonical_key = video.canonical_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM video_death_list AS death
           WHERE death.canonical_key = video.canonical_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM ranking_entries AS current
           WHERE current.period = ?
             AND current.video_id = video.id
        )`
  ).bind(
    PLAYBACK_PERIOD,
    checkedAt,
    payload,
    cutoffAt,
    PLAYBACK_PERIOD
  );
}
