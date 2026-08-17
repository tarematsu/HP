import {
  inferVideoOrientation,
  normalizeVideoOrientationFilter
} from './video-orientation.js';

const MAX_PAGE_SIZE = 100;
const ORIENTATION_SCAN_LIMIT = 100;

function pageLimit(value) {
  const parsed = Math.trunc(Number(value) || 0);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed || MAX_PAGE_SIZE));
}

function cursorVideoId(cursor) {
  if (!cursor || cursor === 'start') return 0;
  const parsed = Number.parseInt(String(cursor), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function activePlaybackRowsStatement(db, afterVideoId, limit) {
  return db.prepare(
    `SELECT video.id AS id,
            video.media_url AS mediaUrl
       FROM videos AS video
      WHERE video.status = 'active'
        AND video.id > ?
      ORDER BY video.id
      LIMIT ?`
  ).bind(afterVideoId, limit);
}

export async function readAllActivePlaybackCursorPage(db, options = {}) {
  const limit = pageLimit(options.limit);
  const orientation = normalizeVideoOrientationFilter(options.orientation);
  const afterVideoId = cursorVideoId(options.cursor);

  if (orientation === 'both') {
    const result = await activePlaybackRowsStatement(db, afterVideoId, limit + 1).all();
    const rows = result?.results || [];
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit && items.length
        ? String(items.at(-1).id)
        : null
    };
  }

  const result = await activePlaybackRowsStatement(
    db,
    afterVideoId,
    ORIENTATION_SCAN_LIMIT + 1
  ).all();
  const rows = result?.results || [];
  const items = [];
  let processed = 0;
  let lastProcessedId = afterVideoId;

  for (const row of rows.slice(0, ORIENTATION_SCAN_LIMIT)) {
    processed += 1;
    lastProcessedId = Number(row.id);
    if (inferVideoOrientation(row.mediaUrl) === orientation) items.push(row);
    if (items.length >= limit) break;
  }

  return {
    items,
    nextCursor: processed < rows.length && processed > 0
      ? String(lastProcessedId)
      : null
  };
}
