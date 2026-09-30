import {
  loadTrackHistoryDayReadModel,
  publishTrackHistoryResponseFromR2Days,
} from './pages-track-history-r2-shards.js';

const DAY_MS = 86_400_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  return parsed != null && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function dayTimestamp(value) {
  const timestamp = Date.parse(`${String(value || '')}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dayText(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function initializeTrackHistoryPublication(_db, publication) {
  if (publication.phase === 'published') return { ...publication };
  return {
    ...publication,
    phase: 'r2-days',
    day_cursor: publication.day_cursor || publication.from,
  };
}

export async function advanceTrackHistoryR2Publication(
  _db,
  r2,
  value,
  now = Date.now(),
  cadenceSeconds = 0,
  dependencies = {},
) {
  const publication = { ...value };
  if (publication.phase === 'published') {
    return { publication, action: 'already-published', published: true, rows: 0, chunks: 0 };
  }
  if (!r2?.get || !r2?.put) throw new Error('track-history R2 publication binding is missing');
  const fromTs = dayTimestamp(publication.from);
  const toTs = dayTimestamp(publication.to);
  let cursor = dayTimestamp(publication.day_cursor || publication.from);
  if (fromTs == null || toTs == null || cursor == null || toTs < fromTs) {
    throw new Error('track-history R2 publication cursor is invalid');
  }
  cursor = Math.max(cursor, fromTs);
  const pageDays = positiveInteger(publication.page_days, 30, 90);
  const loadDay = dependencies.loadDay || loadTrackHistoryDayReadModel;
  let processed = 0;
  while (cursor <= toTs && processed < pageDays) {
    const day = dayText(cursor);
    const existing = await loadDay(r2, day);
    if (!existing) {
      publication.day_cursor = day;
      publication.updated_at = integer(now) ?? Date.now();
      return {
        publication,
        action: 'r2-day-repair',
        published: false,
        rows: 0,
        chunks: 0,
        days: processed,
        bootstrapped: 0,
        missing_day: day,
      };
    }
    cursor += DAY_MS;
    processed += 1;
  }
  publication.days_written = Number(publication.days_written || 0) + processed;
  publication.day_cursor = dayText(cursor);
  publication.updated_at = integer(now) ?? Date.now();
  if (cursor <= toTs) {
    return {
      publication,
      action: 'r2-days',
      published: false,
      rows: 0,
      chunks: 0,
      days: processed,
      bootstrapped: 0,
    };
  }

  const publish = dependencies.publishR2 || publishTrackHistoryResponseFromR2Days;
  const result = await publish(r2, publication, now, cadenceSeconds);
  if (!result?.published) {
    publication.day_cursor = result?.missing_day || publication.from;
    return {
      publication,
      action: 'r2-day-repair',
      published: false,
      rows: 0,
      chunks: 0,
      days: processed,
      bootstrapped: 0,
      missing_day: result?.missing_day || null,
    };
  }
  publication.phase = 'published';
  publication.rows_written = Number(result.rows || 0);
  publication.truncated = result.truncated === true;
  publication.updated_at = integer(now) ?? Date.now();
  return {
    publication,
    action: 'publish-r2-days',
    published: true,
    rows: Number(result.rows || 0),
    chunks: Number(result.chunks || 1),
    days: processed,
    bootstrapped: 0,
    storage: result.storage || 'r2',
  };
}

export async function advanceTrackHistoryPublication() {
  throw new Error('D1 Track History response publication has been retired; use R2 publication');
}
