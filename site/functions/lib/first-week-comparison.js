import {
  KNOWN_HISTORY_GAP_END,
  KNOWN_HISTORY_GAP_START,
} from './known-history-gap.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export const FIRST_WEEK_RELEASES = Object.freeze([
  {
    single: '10th',
    title: 'I want tomorrow to come',
    release_date_jst: '2024-09-25',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00373',
  },
  {
    single: '11th',
    title: 'UDAGAWA GENERATION',
    release_date_jst: '2025-01-28',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00408',
  },
  {
    single: '12th',
    title: 'Make or Break',
    release_date_jst: '2025-05-30',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00454',
  },
  {
    single: '13th',
    title: 'Unhappy birthday構文',
    release_date_jst: '2025-10-16',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00503',
  },
  {
    single: '14th',
    title: 'The growing up train',
    release_date_jst: '2026-02-12',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00523',
  },
  {
    single: '15th',
    title: 'What\'s “KAZOKU”?',
    release_date_jst: '2026-04-19',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00562',
  },
  {
    single: '15th',
    title: 'Lonesome rabbit',
    release_date_jst: '2026-05-19',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00571',
  },
  {
    single: '16th',
    title: '愛MUST BE',
    release_date_jst: '2026-09-17',
    source_url: 'https://sakurazaka46.com/s/s46/news/detail/R00618',
  },
]);

const KNOWN_GAP_START_MS = Date.parse(`${KNOWN_HISTORY_GAP_START}T00:00:00Z`);
const KNOWN_GAP_END_MS = Date.parse(`${KNOWN_HISTORY_GAP_END}T00:00:00Z`) + DAY_MS;

export function releaseStartMs(release) {
  return Date.parse(`${release.release_date_jst}T00:00:00+09:00`);
}

export function releaseOverlapsKnownGap(release) {
  const start = releaseStartMs(release);
  return Number.isFinite(start)
    && start < KNOWN_GAP_END_MS
    && start + WEEK_MS > KNOWN_GAP_START_MS;
}

export const FIRST_WEEK_READ_MODEL_SQL = `SELECT
  release_date_jst,point_count,points_json,updated_at
FROM sh_first_week_comparison_read_model
ORDER BY release_date_jst ASC`;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readModelPoints(row) {
  if (!row || typeof row.points_json !== 'string') return [];
  try {
    const parsed = JSON.parse(row.points_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeFirstWeekRows(rows = []) {
  const normalized = [];
  let streamBaseline = null;
  for (const row of rows) {
    const tuple = Array.isArray(row);
    const elapsed = finite(tuple ? row[0] : row?.elapsed_minutes);
    if (elapsed == null || elapsed < 0 || elapsed > 7 * 24 * 60) continue;
    const listener = finite(tuple ? row[1] : row?.listener_count);
    const streamCount = finite(tuple ? row[2] : row?.stream_count);
    if (streamBaseline == null && streamCount != null) streamBaseline = streamCount;
    const streamGrowth = streamBaseline != null && streamCount != null && streamCount >= streamBaseline
      ? streamCount - streamBaseline
      : null;
    normalized.push([
      elapsed,
      listener,
      streamGrowth,
    ]);
  }
  return normalized;
}

export async function loadFirstWeekComparison(db) {
  if (!db?.prepare) throw new Error('MINUTE_DB binding missing');

  const readModel = await db.prepare(FIRST_WEEK_READ_MODEL_SQL).all();
  const rowsByRelease = new Map(
    (readModel?.results || []).map((row) => [String(row.release_date_jst || ''), row]),
  );

  const series = FIRST_WEEK_RELEASES.map((release) => {
    if (releaseOverlapsKnownGap(release)) {
      return {
        ...release,
        status: 'known_missing',
        points: [],
      };
    }
    const row = rowsByRelease.get(release.release_date_jst);
    const points = normalizeFirstWeekRows(readModelPoints(row));
    return {
      ...release,
      status: points.length ? 'available' : 'no_data',
      points,
    };
  });

  return {
    series,
    point_count: series.reduce((sum, item) => sum + item.points.length, 0),
    bucket_minutes: 5,
    duration_minutes: 7 * 24 * 60,
    timezone: 'Asia/Tokyo',
    known_gap: {
      start: KNOWN_HISTORY_GAP_START,
      end: KNOWN_HISTORY_GAP_END,
    },
  };
}
