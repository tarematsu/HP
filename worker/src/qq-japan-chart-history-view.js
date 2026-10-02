import { QQ_JAPAN_TOPLIST_ID } from './regional-music-qq.js';

export const QQ_JAPAN_HISTORY_PREFIX = 'regional-music/qq_music/japan-toplist-history';
export const QQ_JAPAN_HISTORY_INDEX_KEY = `${QQ_JAPAN_HISTORY_PREFIX}/index.json`;
export const QQ_JAPAN_HISTORY_VIEW_KEY = `${QQ_JAPAN_HISTORY_PREFIX}/view.json`;
export const QQ_JAPAN_HISTORY_TARGETS = Object.freeze([
  'sakurazaka46',
  'nogizaka46',
  'hinatazaka46',
]);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeQqJapanHistoryPeriod(value) {
  const match = String(value || '').match(/(\d{4})\D+(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}_${Number(match[2])}`;
}

export function compareQqJapanHistoryPeriods(left, right) {
  const a = normalizeQqJapanHistoryPeriod(left);
  const b = normalizeQqJapanHistoryPeriod(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  const [aYear, aWeek] = a.split('_').map(Number);
  const [bYear, bWeek] = b.split('_').map(Number);
  return (aYear - bYear) || (aWeek - bWeek);
}

export function qqIsoWeekPeriod(dateLike) {
  const input = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(input.getTime())) throw new Error('invalid QQ history date');
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3);
  const week = 1 + Math.round((date.getTime() - jan4.getTime()) / WEEK_MS);
  return `${isoYear}_${week}`;
}

export function qqJapanHistoryR2Key(period) {
  const normalized = normalizeQqJapanHistoryPeriod(period);
  if (!normalized) throw new Error('invalid QQ history period');
  return `${QQ_JAPAN_HISTORY_PREFIX}/weeks/${normalized}.json`;
}

export function filterQqJapanSakamichiEntries(entries = []) {
  return entries
    .filter((row) => QQ_JAPAN_HISTORY_TARGETS.includes(row.canonical_artist))
    .map((row) => ({
      position:row.position,
      track_id:row.track_id,
      title:row.title ?? null,
      album_name:row.album_name ?? null,
      canonical_artist:row.canonical_artist,
      artists:(row.artists || []).map((artist) => ({ mid:artist.mid ?? null, name:artist.name ?? '' })),
    }));
}

function countTargets(entries) {
  return Object.fromEntries(QQ_JAPAN_HISTORY_TARGETS.map((artist) => [artist,
    entries.filter((row) => row.canonical_artist === artist).length]));
}

export function qqJapanHistoryRecord(period, chart, collectedAt = Date.now()) {
  const entries = filterQqJapanSakamichiEntries(chart?.entries || []);
  return {
    version:1,
    service:'qq_music',
    chart:'japan_toplist',
    top_id:QQ_JAPAN_TOPLIST_ID,
    period:normalizeQqJapanHistoryPeriod(period),
    provider_period:chart?.provider_period ?? null,
    update_time:chart?.update_time ?? null,
    collected_at:Number(collectedAt),
    source_url:`https://y.qq.com/n/ryqq/toplist/${QQ_JAPAN_TOPLIST_ID}`,
    counts:countTargets(entries),
    entries,
  };
}

export function qqJapanHistorySummary(record) {
  return {
    period:record.period,
    provider_period:record.provider_period ?? null,
    update_time:record.update_time ?? null,
    collected_at:record.collected_at,
    counts:record.counts,
    entries:Array.isArray(record.entries) ? record.entries.length : 0,
  };
}

function isoWeekThursday(period) {
  const normalized = normalizeQqJapanHistoryPeriod(period);
  if (!normalized) return '';
  const [year, week] = normalized.split('_').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - jan4Weekday * 24 * 60 * 60 * 1000 + (week - 1) * WEEK_MS);
  const thursday = new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000);
  return thursday.toISOString().slice(0, 10);
}

function displayDate(record) {
  const text = String(record?.update_time || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : isoWeekThursday(record?.period);
}

export function qqJapanHistoryRows(record) {
  const period = normalizeQqJapanHistoryPeriod(record?.period);
  const publishedAt = displayDate(record);
  return (Array.isArray(record?.entries) ? record.entries : []).map((entry) => ({
    period,
    published_at:publishedAt,
    update_time:record?.update_time ?? null,
    canonical_artist:entry.canonical_artist,
    rank:Number(entry.position),
    title:entry.title ?? null,
    track_id:entry.track_id ?? null,
    album_name:entry.album_name ?? null,
  }));
}

export function qqJapanHistoryIndex(weeks = {}, updatedAt = Date.now(), base = {}) {
  const sortedPeriods = Object.keys(weeks).sort(compareQqJapanHistoryPeriods);
  return {
    ...base,
    version:1,
    service:'qq_music',
    chart:'japan_toplist',
    updated_at:Number(updatedAt),
    earliest_period:sortedPeriods[0] || null,
    latest_period:sortedPeriods.at(-1) || null,
    weeks,
  };
}

export function qqJapanHistoryViewFromRows(index, history = [], updatedAt = Date.now()) {
  const rows = [...history]
    .filter((item) => item?.period && QQ_JAPAN_HISTORY_TARGETS.includes(item?.canonical_artist) && Number.isFinite(Number(item?.rank)))
    .sort((a, b) => compareQqJapanHistoryPeriods(b.period, a.period)
      || Number(a.rank) - Number(b.rank)
      || String(a.title || '').localeCompare(String(b.title || '')));
  const rankPeriods = rows.map((item) => item.period).sort(compareQqJapanHistoryPeriods);
  return {
    version:1,
    service:'qq_music',
    chart:'japan_toplist',
    updated_at:Number(updatedAt),
    coverage:{
      earliest_period:index?.earliest_period ?? null,
      latest_period:index?.latest_period ?? null,
      latest_rank_in_period:rankPeriods.at(-1) || null,
      stored_periods:Object.keys(index?.weeks || {}).length,
      entries:rows.length,
    },
    history:rows,
  };
}

export function qqJapanHistoryView(records = [], updatedAt = Date.now()) {
  const weeks = {};
  const rows = [];
  for (const record of records) {
    if (!record?.period) continue;
    weeks[record.period] = qqJapanHistorySummary(record);
    rows.push(...qqJapanHistoryRows(record));
  }
  const index = qqJapanHistoryIndex(weeks, updatedAt);
  return {
    index,
    view:qqJapanHistoryViewFromRows(index, rows, updatedAt),
  };
}

export async function upsertQqJapanHistoryArtifacts({ load, save, record, updatedAt = Date.now() }) {
  if (!record?.period) throw new Error('QQ Japan history record period missing');
  const existingIndex = await load(QQ_JAPAN_HISTORY_INDEX_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  weeks[record.period] = qqJapanHistorySummary(record);
  const index = qqJapanHistoryIndex(weeks, updatedAt, existingIndex || {});

  const existingView = await load(QQ_JAPAN_HISTORY_VIEW_KEY);
  const history = (Array.isArray(existingView?.history) ? existingView.history : [])
    .filter((item) => normalizeQqJapanHistoryPeriod(item?.period) !== record.period);
  history.push(...qqJapanHistoryRows(record));
  const view = qqJapanHistoryViewFromRows(index, history, updatedAt);

  await save(qqJapanHistoryR2Key(record.period), record);
  await save(QQ_JAPAN_HISTORY_INDEX_KEY, index);
  await save(QQ_JAPAN_HISTORY_VIEW_KEY, view);
  return { index, view };
}
