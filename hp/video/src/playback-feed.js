import { collectPlaybackCursorPage } from './playback-cursor.js';

export const SHUFFLE_MULTIPLIER = 1_103_515_245;
export const SHUFFLE_INCREMENT = 12_345;
export const SHUFFLE_MODULUS = 2_147_483_647;
export const SHUFFLE_SQL_EXPRESSION = '((ranking.video_id % 2147483647) * 1103515245) % 2147483647';

const SHUFFLE_MULTIPLIER_BIGINT = BigInt(SHUFFLE_MULTIPLIER);
const SHUFFLE_MODULUS_BIGINT = BigInt(SHUFFLE_MODULUS);

export function videoShuffleKey(videoId) {
  let value;
  try {
    value = BigInt(videoId);
  } catch {
    value = 0n;
  }
  const normalized = ((value % SHUFFLE_MODULUS_BIGINT) + SHUFFLE_MODULUS_BIGINT)
    % SHUFFLE_MODULUS_BIGINT;
  return Number((normalized * SHUFFLE_MULTIPLIER_BIGINT) % SHUFFLE_MODULUS_BIGINT);
}

export function seedShufflePivot(seed) {
  const shift = (Number(seed) * SHUFFLE_INCREMENT) % SHUFFLE_MODULUS;
  return shift === 0 ? 0 : SHUFFLE_MODULUS - shift;
}

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

async function collectPage(db, options) {
  const limit = Math.max(0, Number(options.limit) || 0);
  const pivot = seedShufflePivot(options.seed);
  return collectPlaybackCursorPage(
    limit,
    options.cursor,
    async (phase, cursor, requested) => {
      const result = await cursorRangeStatement(db, phase, pivot, cursor, requested).all();
      return result?.results || [];
    }
  );
}

export async function readActivePlaybackFallbackPage(db, options) {
  const limit = Math.max(0, Number(options.limit) || 0);
  if (!limit) return { items: [], nextCursor: null };
  const result = await db.prepare(
    `SELECT video.id, video.media_url AS mediaUrl
       FROM videos AS video
      WHERE video.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM video_blocklist AS bad
           WHERE bad.canonical_key = video.canonical_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM video_death_list AS death
           WHERE death.canonical_key = video.canonical_key
        )
      ORDER BY video.id DESC
      LIMIT ?`
  ).bind(limit).all();
  return {
    items: (result?.results || []).map((row) => ({ id: row.id, mediaUrl: row.mediaUrl })),
    nextCursor: null
  };
}

export function invalidatePlaybackCache() {}

export async function readSeededPlaybackCursorPage(db, options) {
  const page = await collectPage(db, options);
  if (page.rows.length || page.nextCursor || !isInitialCursor(options.cursor)) {
    return {
      items: page.rows.map((row) => ({ id: row.id, mediaUrl: row.mediaUrl })),
      nextCursor: page.nextCursor
    };
  }
  return readActivePlaybackFallbackPage(db, options);
}
