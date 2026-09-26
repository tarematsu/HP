import {
  KNOWN_HISTORY_GAP_END,
  KNOWN_HISTORY_GAP_START,
} from './known-history-gap.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const FIVE_MINUTES_MS = 5 * 60_000;

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

export const FIRST_WEEK_SERIES_SQL = `WITH window_rows AS MATERIALIZED (
  SELECT
    f.id,f.minute_at,f.observed_at,f.channel_id,f.listener_count,f.source_code,
    f.reported_total_listens AS total_listens,
    f.reported_current_stream_count AS current_stream_count
  FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_time
  WHERE f.minute_at>=?1 AND f.minute_at<?2
), selected_channel AS (
  SELECT channel_id
  FROM window_rows
  GROUP BY channel_id
  ORDER BY COUNT(*) DESC,MAX(observed_at) DESC,channel_id ASC
  LIMIT 1
), normalized AS MATERIALIZED (
  SELECT
    id,minute_at,observed_at,listener_count,
    CAST((minute_at-?1)/${FIVE_MINUTES_MS} AS INTEGER) AS bucket_index,
    CASE
      WHEN source_code IN (3,4)
        THEN CASE WHEN total_listens>0 THEN total_listens END
      WHEN current_stream_count IS NOT NULL
        AND current_stream_count>0
        AND current_stream_count IS NOT total_listens
        THEN current_stream_count
      ELSE NULL
    END AS stream_count
  FROM window_rows
  WHERE channel_id=(SELECT channel_id FROM selected_channel)
), buckets AS MATERIALIZED (
  SELECT DISTINCT bucket_index FROM normalized
), listener_ranked AS (
  SELECT
    bucket_index,observed_at,listener_count,
    ROW_NUMBER() OVER (
      PARTITION BY bucket_index
      ORDER BY minute_at DESC,id DESC
    ) AS metric_rank
  FROM normalized
  WHERE listener_count IS NOT NULL
), stream_ranked AS (
  SELECT
    bucket_index,observed_at,stream_count,
    ROW_NUMBER() OVER (
      PARTITION BY bucket_index
      ORDER BY minute_at DESC,id DESC
    ) AS metric_rank
  FROM normalized
  WHERE stream_count IS NOT NULL
)
SELECT
  buckets.bucket_index*5 AS elapsed_minutes,
  COALESCE(listener_ranked.observed_at,stream_ranked.observed_at) AS observed_at,
  listener_ranked.listener_count,
  stream_ranked.stream_count
FROM buckets
LEFT JOIN listener_ranked
  ON listener_ranked.bucket_index=buckets.bucket_index
  AND listener_ranked.metric_rank=1
LEFT JOIN stream_ranked
  ON stream_ranked.bucket_index=buckets.bucket_index
  AND stream_ranked.metric_rank=1
ORDER BY buckets.bucket_index ASC`;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeFirstWeekRows(rows = []) {
  const normalized = [];
  let streamBaseline = null;
  for (const row of rows) {
    const elapsed = finite(row?.elapsed_minutes);
    if (elapsed == null || elapsed < 0 || elapsed > 7 * 24 * 60) continue;
    const listener = finite(row?.listener_count);
    const streamCount = finite(row?.stream_count);
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

  const queryable = [];
  const results = new Map();
  for (const release of FIRST_WEEK_RELEASES) {
    if (releaseOverlapsKnownGap(release)) {
      results.set(release, {
        ...release,
        status: 'known_missing',
        points: [],
      });
      continue;
    }
    const start = releaseStartMs(release);
    const end = start + WEEK_MS;
    queryable.push({
      release,
      statement: db.prepare(FIRST_WEEK_SERIES_SQL).bind(start, end),
    });
  }

  const batches = queryable.length
    ? await db.batch(queryable.map(({ statement }) => statement))
    : [];

  queryable.forEach(({ release }, index) => {
    const points = normalizeFirstWeekRows(batches[index]?.results || []);
    results.set(release, {
      ...release,
      status: points.length ? 'available' : 'no_data',
      points,
    });
  });

  const series = FIRST_WEEK_RELEASES.map((release) => results.get(release));
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
