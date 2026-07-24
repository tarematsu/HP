import {
  encodePlaybackCursor,
  parsePlaybackCursor
} from './playback-cursor.js';
import {
  readActivePlaybackFallbackPage,
  seedShufflePivot,
  SHUFFLE_SQL_EXPRESSION
} from './playback-feed.js';
import { inferVideoOrientation } from './video-orientation.js';

const ORIENTATION_SCAN_LIMIT = 100;
const ORIENTATION_QUERY_FLOOR = 16;
const ORIENTATION_QUERY_MULTIPLIER = 1;

function cursorRangeStatement(db, phase, pivot, cursor, limit) {
  const comparison = phase === 0 ? '>=' : '<';
  const cursorClause = cursor
    ? `AND (${SHUFFLE_SQL_EXPRESSION} > ? OR (${SHUFFLE_SQL_EXPRESSION} = ? AND ranking.video_id > ?))`
    : '';
  const statement = db.prepare(
    `SELECT video.id, video.media_url AS mediaUrl,
            ${SHUFFLE_SQL_EXPRESSION} AS shuffleKey
       FROM ranking_entries AS ranking
       INNER JOIN videos AS video ON video.id = ranking.video_id
      WHERE ranking.period = '24h'
        AND video.status = 'active'
        AND ${SHUFFLE_SQL_EXPRESSION} ${comparison} ?
        ${cursorClause}
      ORDER BY ${SHUFFLE_SQL_EXPRESSION}, ranking.video_id
      LIMIT ?`
  );
  if (cursor) {
    return statement.bind(
      pivot,
      cursor.shuffleKey,
      cursor.shuffleKey,
      cursor.videoId,
      limit
    );
  }
  return statement.bind(pivot, limit);
}

function isInitialCursor(value) {
  return value == null || value === '' || value === 'start';
}

export function invalidateOrientationPlaybackCache() {}

export async function readOrientationPlaybackCursorPage(db, options) {
  const limit = Math.max(0, Number(options.limit) || 0);
  if (!limit) return { items: [], nextCursor: null };

  const pivot = seedShufflePivot(options.seed);
  const scanLimit = Math.min(
    ORIENTATION_SCAN_LIMIT,
    Math.max(limit, limit * 3)
  );
  let cursor = parsePlaybackCursor(options.cursor);
  let phase = cursor?.phase ?? 0;
  let scanned = 0;
  let lastScanned = null;
  let hasMore = false;
  const items = [];

  while (phase <= 1 && items.length < limit && scanned < scanLimit) {
    const remainingScan = scanLimit - scanned;
    const desiredCandidates = Math.max(
      ORIENTATION_QUERY_FLOOR,
      (limit - items.length) * ORIENTATION_QUERY_MULTIPLIER
    );
    const processBudget = Math.min(remainingScan, desiredCandidates);
    const requested = processBudget + 1;
    const result = await cursorRangeStatement(
      db,
      phase,
      pivot,
      cursor,
      requested
    ).all();
    const batch = result?.results || [];
    const processCount = Math.min(batch.length, processBudget);

    for (let index = 0; index < processCount; index += 1) {
      const row = batch[index];
      scanned += 1;
      lastScanned = { phase, row };
      if (inferVideoOrientation(row.mediaUrl) === options.orientation) {
        items.push({ id: row.id, mediaUrl: row.mediaUrl });
      }
      if (items.length >= limit) {
        hasMore = index + 1 < batch.length || phase === 0;
        break;
      }
    }
    if (items.length >= limit) break;

    if (processCount > 0) {
      const row = batch[processCount - 1];
      cursor = {
        phase,
        shuffleKey: Number(row.shuffleKey),
        videoId: Number(row.id)
      };
    }

    if (batch.length > processBudget) {
      if (scanned >= scanLimit) {
        hasMore = true;
        break;
      }
      continue;
    }

    if (phase === 0) {
      phase = 1;
      cursor = null;
      if (scanned >= scanLimit) {
        hasMore = true;
        break;
      }
      continue;
    }
    phase = 2;
  }

  if (!hasMore && scanned >= scanLimit && phase <= 1) hasMore = true;
  const nextCursor = hasMore && lastScanned
    ? encodePlaybackCursor(lastScanned.phase, lastScanned.row)
    : null;
  if (items.length || nextCursor || scanned > 0 || !isInitialCursor(options.cursor)) {
    return { items, nextCursor };
  }

  const fallback = await readActivePlaybackFallbackPage(db, { limit: scanLimit });
  return {
    items: fallback.items
      .filter((row) => inferVideoOrientation(row.mediaUrl) === options.orientation)
      .slice(0, limit),
    nextCursor: null
  };
}
