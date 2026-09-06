import {
  matchesVideoOrientationFilter,
  normalizeVideoOrientationFilter
} from './video-orientation.js';
import {
  invalidateFeedSnapshotCache,
  readFeedSnapshotPage
} from './feed-snapshot.js';
import { buildWeightedPlaybackPage } from './weighted-playback.js';

const MAX_PAGE_SIZE = 100;

function pageLimit(value) {
  const parsed = Math.trunc(Number(value) || 0);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed || MAX_PAGE_SIZE));
}

export function activePlaybackRowsStatement(db) {
  return db.prepare(
    `SELECT video.id AS id,
            video.media_url AS mediaUrl,
            video.first_seen_at AS firstSeenAt
       FROM videos AS video
      WHERE video.status = 'active'
      ORDER BY video.id`
  );
}

export function invalidateAllActivePlaybackCache(db) {
  invalidateFeedSnapshotCache(db);
}

export async function readAllActivePlaybackCursorPage(db, options = {}) {
  const limit = pageLimit(options.limit);
  const orientation = normalizeVideoOrientationFilter(options.orientation);
  const snapshot = await readFeedSnapshotPage(db, {
    ...options,
    limit,
    orientation
  });
  if (snapshot) return snapshot;

  const result = await activePlaybackRowsStatement(db).all();
  const rows = result?.results || [];
  const candidates = orientation === 'both'
    ? rows
    : rows.filter((row) => matchesVideoOrientationFilter(row.mediaUrl, orientation));
  const page = buildWeightedPlaybackPage(candidates, {
    ...options,
    limit
  });
  return {
    items: page.rows.map((row) => ({ id: row.id, mediaUrl: row.mediaUrl })),
    nextCursor: page.nextCursor
  };
}
