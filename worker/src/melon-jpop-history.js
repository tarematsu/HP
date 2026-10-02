import { visibleHtmlText } from './regional-music-html.js';

export const MELON_JPOP_HISTORY_VIEW_KEY = 'regional-music/melon/jpop-chart-history/view.json';
export const MELON_JPOP_CLASS_CD = 'GN1900';
export const MELON_JPOP_HISTORY_START = '2012-01-01';

export const MELON_JPOP_HISTORY_ARTISTS = Object.freeze({
  sakurazaka46: Object.freeze({
    display_name: '櫻坂46',
    aliases: Object.freeze(['櫻坂46', 'Sakurazaka46', 'SAKURAZAKA46', '사쿠라자카46']),
  }),
  nogizaka46: Object.freeze({
    display_name: '乃木坂46',
    aliases: Object.freeze(['乃木坂46', 'Nogizaka46', 'NOGIZAKA46', '노기자카46']),
  }),
  hinatazaka46: Object.freeze({
    display_name: '日向坂46',
    aliases: Object.freeze(['日向坂46', 'Hinatazaka46', 'HINATAZAKA46', '히나타자카46']),
  }),
  keyakizaka46: Object.freeze({
    display_name: '欅坂46',
    aliases: Object.freeze(['欅坂46', 'Keyakizaka46', 'KEYAKIZAKA46', '케야키자카46']),
  }),
  hiragana_keyakizaka46: Object.freeze({
    display_name: 'けやき坂46',
    aliases: Object.freeze([
      'けやき坂46',
      'Hiragana Keyakizaka46',
      'HIRAGANA KEYAKIZAKA46',
      'Hiragana Keyaki',
      '히라가나 케야키자카46',
    ]),
  }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s·・･._-]+/g, '');
}

const MELON_JPOP_HISTORY_ALIAS_MATCHERS = Object.freeze(
  Object.entries(MELON_JPOP_HISTORY_ARTISTS)
    .flatMap(([canonicalArtist, definition]) => definition.aliases.map((alias) => ({
      canonical_artist: canonicalArtist,
      alias: normalize(alias),
    })))
    .sort((a, b) => b.alias.length - a.alias.length || a.canonical_artist.localeCompare(b.canonical_artist)),
);

function compactDate(value) {
  return String(value || '').replaceAll('-', '');
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function utcDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function rowBlocks(html) {
  return String(html || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
}

function rowTrackId(row) {
  return row.match(/data-song-no=["'](\d+)["']/i)?.[1]
    || row.match(/goSongDetail\(['"]?(\d+)['"]?\)/i)?.[1]
    || row.match(/songId=(\d+)/i)?.[1]
    || null;
}

function rowPosition(row) {
  const rank = row.match(/class=["'][^"']*(?:^|\s)rank(?:\s|["'])[^>]*>\s*(?:<[^>]+>\s*)*(\d+)/i)?.[1]
    || row.match(/class=["'][^"']*(?:rank|num)[^"']*["'][^>]*>\s*(\d+)\s*</i)?.[1];
  const value = Number(rank);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function rowField(row, className) {
  const match = row.match(new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:div|td)>`, 'i'));
  return match ? visibleHtmlText(match[1]) : '';
}

function rowTitle(row) {
  const field = rowField(row, 'rank01');
  if (field) return field;
  const link = row.match(/<a\b[^>]*(?:goSongDetail\([^)]*\)|songId=\d+)[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  return link ? visibleHtmlText(link) : null;
}

function rowAlbum(row) {
  const field = rowField(row, 'rank03');
  return field || null;
}

function rowArtistText(row) {
  return rowField(row, 'rank02') || '';
}

export function canonicalMelonJpopHistoryArtist(value) {
  const text = normalize(value);
  if (!text) return null;
  return MELON_JPOP_HISTORY_ALIAS_MATCHERS.find((item) => text.includes(item.alias))?.canonical_artist || null;
}

export function parseMelonJpopHistoryEntries(html) {
  const entries = [];
  for (const row of rowBlocks(html)) {
    const position = rowPosition(row);
    const trackId = rowTrackId(row);
    if (!position || !trackId) continue;
    const artistText = rowArtistText(row);
    const canonicalArtist = canonicalMelonJpopHistoryArtist(artistText);
    if (!canonicalArtist) continue;
    entries.push({
      canonical_artist: canonicalArtist,
      position,
      track_id: trackId,
      title: rowTitle(row),
      album_name: rowAlbum(row),
      artist_text: artistText || null,
    });
  }
  return entries.sort((a, b) => a.position - b.position || String(a.title || '').localeCompare(String(b.title || '')));
}

export function parseMelonWeeklyPeriod(html) {
  const text = visibleHtmlText(html);
  const match = text.match(/(20\d{2})[.\/-](\d{2})[.\/-](\d{2})\s*~\s*(20\d{2})[.\/-](\d{2})[.\/-](\d{2})/u);
  if (!match) return null;
  return {
    start: `${match[1]}-${match[2]}-${match[3]}`,
    end: `${match[4]}-${match[5]}-${match[6]}`,
  };
}

export function parseMelonMonthlyPeriod(html) {
  const text = visibleHtmlText(html);
  const match = text.match(/(?:^|\s)(20\d{2})[.\/-](\d{2})(?=\s|$)/u);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function melonJpopWeeklyUrl(start, end, classCd = MELON_JPOP_CLASS_CD) {
  return `https://www.melon.com/chart/week/index.htm?classCd=${encodeURIComponent(classCd)}&moved=Y&startDay=${compactDate(start)}&endDay=${compactDate(end)}`;
}

export function melonJpopLegacyWeeklyUrl(start, end, classCd = MELON_JPOP_CLASS_CD) {
  const year = String(start).slice(0, 4);
  const month = String(start).slice(5, 7);
  const startDay = compactDate(start);
  const endDay = compactDate(end);
  return `https://www.melon.com/chart/search/list.htm?chartType=WE&age=2010&year=${year}&mon=${month}&day=${startDay}%5E${endDay}&classCd=${encodeURIComponent(classCd)}&startDay=${startDay}&endDay=${endDay}&moved=Y`;
}

export function melonJpopMonthlyUrl(period, classCd = MELON_JPOP_CLASS_CD) {
  return `https://www.melon.com/chart/month/index.htm?classCd=${encodeURIComponent(classCd)}&moved=Y&rankMonth=${String(period).replace('-', '')}`;
}

export function melonJpopLegacyMonthlyUrl(period, classCd = MELON_JPOP_CLASS_CD) {
  const [year, month] = String(period).split('-');
  return `https://www.melon.com/chart/search/list.htm?chartType=MO&age=2010&year=${year}&mon=${month}&classCd=${encodeURIComponent(classCd)}&moved=Y`;
}

export function melonWeeklyUrlCandidates(start, end) {
  const year = Number(String(start).slice(0, 4));
  const codes = year < 2017 ? [MELON_JPOP_CLASS_CD, 'DP1900'] : [MELON_JPOP_CLASS_CD];
  const urls = [];
  for (const code of codes) {
    urls.push(melonJpopWeeklyUrl(start, end, code));
    if (year < 2020) urls.push(melonJpopLegacyWeeklyUrl(start, end, code));
  }
  return [...new Set(urls)];
}

export function melonMonthlyUrlCandidates(period) {
  const year = Number(String(period).slice(0, 4));
  const codes = year < 2017 ? [MELON_JPOP_CLASS_CD, 'DP1900'] : [MELON_JPOP_CLASS_CD];
  const urls = [];
  for (const code of codes) {
    urls.push(melonJpopMonthlyUrl(period, code));
    if (year < 2020) urls.push(melonJpopLegacyMonthlyUrl(period, code));
  }
  return [...new Set(urls)];
}

export function melonCompletedWeeklyPeriods(start = MELON_JPOP_HISTORY_START, now = Date.now()) {
  const first = utcDate(start);
  const weekday = first.getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7;
  let cursor = new Date(first.getTime() + daysUntilMonday * DAY_MS);
  const today = new Date(now);
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysSinceSunday = todayUtc.getUTCDay();
  const lastSunday = new Date(todayUtc.getTime() - daysSinceSunday * DAY_MS);
  if (daysSinceSunday === 0) lastSunday.setUTCDate(lastSunday.getUTCDate() - 7);
  const periods = [];
  while (cursor.getTime() + 6 * DAY_MS <= lastSunday.getTime()) {
    const end = new Date(cursor.getTime() + 6 * DAY_MS);
    periods.push({
      type: 'week',
      period: `${isoDate(cursor)}_${isoDate(end)}`,
      start: isoDate(cursor),
      end: isoDate(end),
    });
    cursor = new Date(cursor.getTime() + 7 * DAY_MS);
  }
  return periods;
}

export function melonCompletedMonthlyPeriods(start = MELON_JPOP_HISTORY_START, now = Date.now()) {
  const first = utcDate(start);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const current = new Date(now);
  const lastYear = current.getUTCMonth() === 0 ? current.getUTCFullYear() - 1 : current.getUTCFullYear();
  const lastMonth = current.getUTCMonth() === 0 ? 11 : current.getUTCMonth() - 1;
  const periods = [];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const value = `${year}-${String(month + 1).padStart(2, '0')}`;
    periods.push({ type: 'month', period: value });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return periods;
}

function historyRow(record, entry) {
  return {
    period_type: record.type,
    period: record.period,
    start: record.start ?? null,
    end: record.end ?? null,
    canonical_artist: entry.canonical_artist,
    rank: Number(entry.position),
    title: entry.title ?? null,
    track_id: entry.track_id ?? null,
    album_name: entry.album_name ?? null,
    artist_text: entry.artist_text ?? null,
  };
}

export function melonJpopHistoryView(records = [], updatedAt = Date.now()) {
  const periods = records.map((record) => ({
    period_type: record.type,
    period: record.period,
    start: record.start ?? null,
    end: record.end ?? null,
    status: record.status || 'ok',
    source_url: record.source_url ?? null,
    entries: Array.isArray(record.entries) ? record.entries.length : 0,
    error: record.error ?? null,
  })).sort((a, b) => a.period_type.localeCompare(b.period_type) || a.period.localeCompare(b.period));
  const history = records.flatMap((record) => (Array.isArray(record.entries) ? record.entries : []).map((entry) => historyRow(record, entry)))
    .sort((a, b) => b.period.localeCompare(a.period) || a.period_type.localeCompare(b.period_type) || a.rank - b.rank);
  const successful = periods.filter((item) => item.status === 'ok');
  const failed = periods.filter((item) => item.status !== 'ok');
  const byType = Object.fromEntries(['week', 'month'].map((type) => {
    const items = periods.filter((item) => item.period_type === type && item.status === 'ok');
    return [type, {
      checked_periods: items.length,
      earliest_period: items[0]?.period ?? null,
      latest_period: items.at(-1)?.period ?? null,
      entries: history.filter((item) => item.period_type === type).length,
    }];
  }));
  return {
    version: 1,
    service: 'melon',
    chart: 'jpop',
    class_cd: MELON_JPOP_CLASS_CD,
    updated_at: Number(updatedAt) || Date.now(),
    artists: Object.fromEntries(Object.entries(MELON_JPOP_HISTORY_ARTISTS).map(([key, value]) => [key, value.display_name])),
    coverage: {
      checked_periods: successful.length,
      failed_periods: failed.length,
      entries: history.length,
      week: byType.week,
      month: byType.month,
    },
    periods,
    history,
  };
}
