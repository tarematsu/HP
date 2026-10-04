import { KKBOX_JAPANESE_CATEGORY, canonicalKkboxArtists, kkboxChartId } from './regional-music-kkbox.js';

export const KKBOX_JAPANESE_HISTORY_VIEW_KEY = 'regional-music/kkbox/japanese-chart-history/view.json';
export const KKBOX_JAPANESE_HISTORY_START = '2012-01-01';

const KKBOX_CURRENT_ARTISTS = new Set(['sakurazaka46', 'nogizaka46', 'hinatazaka46']);

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function currentCanonicalArtists(value) {
  return Array.isArray(value) ? value.filter((artist) => KKBOX_CURRENT_ARTISTS.has(artist)) : [];
}

function currentGroupEntry(entry) {
  return currentCanonicalArtists(entry?.canonical_artists).length > 0;
}

function recordKey(record) {
  return [
    record?.territory,
    record?.period_type,
    record?.chart_type,
    record?.requested_date || record?.period,
  ].join('|');
}

function historyKey(row) {
  return [
    row?.territory,
    row?.period_type,
    row?.chart_type,
    row?.period,
    row?.track_id,
  ].join('|');
}

function seriesKey(value) {
  return `${value?.territory}/${value?.period_type}/${value?.chart_type}`;
}

function rowFromRecord(record, entry) {
  return {
    territory: record.territory,
    period_type: record.period_type,
    chart_type: record.chart_type,
    period: record.period,
    canonical_artists: currentCanonicalArtists(entry.canonical_artists),
    rank: Number(entry.rank),
    previous_rank: Number(entry.previous_rank) > 0 ? Number(entry.previous_rank) : null,
    title: entry.title ?? null,
    track_id: entry.track_id ?? null,
    artist_name: entry.artist_name ?? null,
    artist_roles: entry.artist_roles ?? null,
    album_name: entry.album_name ?? null,
    track_url: entry.track_url ?? null,
  };
}

function periodSummary(record) {
  return {
    territory: record.territory,
    period_type: record.period_type,
    chart_type: record.chart_type,
    requested_date: record.requested_date ?? record.period ?? null,
    period: record.period ?? null,
    status: record.status || 'ok',
    source_url: record.source_url ?? null,
    source_rows: Number(record.source_rows) || 0,
    entries: Array.isArray(record.entries) ? record.entries.filter(currentGroupEntry).length : 0,
    error: record.error ?? null,
  };
}

function sortPeriods(a, b) {
  return String(a.period || a.requested_date || '').localeCompare(String(b.period || b.requested_date || ''))
    || String(a.territory).localeCompare(String(b.territory))
    || String(a.period_type).localeCompare(String(b.period_type))
    || String(a.chart_type).localeCompare(String(b.chart_type));
}

function sortHistory(a, b) {
  return String(b.period || '').localeCompare(String(a.period || ''))
    || String(a.territory).localeCompare(String(b.territory))
    || String(a.period_type).localeCompare(String(b.period_type))
    || String(a.chart_type).localeCompare(String(b.chart_type))
    || Number(a.rank) - Number(b.rank)
    || String(a.title || '').localeCompare(String(b.title || ''));
}

export function kkboxHistoryRecord(chart, result, requestedDate = null) {
  const period = dateOnly(result?.provider_date) || dateOnly(requestedDate);
  return {
    territory: chart.territory,
    period_type: chart.period,
    chart_type: chart.type,
    requested_date: dateOnly(requestedDate) || period,
    period,
    status: 'ok',
    source_url: result?.source_url ?? null,
    source_rows: Number(result?.source_rows) || 0,
    entries: Array.isArray(result?.entries) ? result.entries.filter(currentGroupEntry) : [],
  };
}

export function kkboxHistoryErrorRecord(chart, requestedDate, error) {
  return {
    territory: chart.territory,
    period_type: chart.period,
    chart_type: chart.type,
    requested_date: dateOnly(requestedDate),
    period: null,
    status: 'error',
    source_url: null,
    source_rows: 0,
    entries: [],
    error: String(error?.message || error).slice(0, 1000),
  };
}

export function kkboxHistoryRecordsFromSnapshot(snapshot) {
  if (snapshot?.service !== 'kkbox') return [];
  const tracks = new Map((Array.isArray(snapshot?.tracks) ? snapshot.tracks : [])
    .map((row) => [String(row?.service_track_id || ''), row]));
  const memberships = Array.isArray(snapshot?.playlist_memberships) ? snapshot.playlist_memberships : [];
  const records = [];

  for (const playlist of Array.isArray(snapshot?.playlists) ? snapshot.playlists : []) {
    if (playlist?.service !== 'kkbox' || playlist?.playlist_type !== 'chart') continue;
    const territory = String(playlist?.territory || '');
    const periodType = String(playlist?.chart_period || '');
    const chartType = String(playlist?.chart_type || '');
    if (!['tw', 'hk'].includes(territory)
        || !['daily', 'weekly'].includes(periodType)
        || !['song', 'newrelease'].includes(chartType)) continue;
    const chart = { territory, period: periodType, type: chartType };
    if (String(playlist.service_playlist_id) !== kkboxChartId(chart)) continue;

    const entries = memberships
      .filter((row) => String(row?.service_playlist_id || '') === String(playlist.service_playlist_id))
      .map((row) => {
        const track = tracks.get(String(row?.service_track_id || '')) || {};
        const canonicalArtists = currentCanonicalArtists(
          Array.isArray(row?.canonical_artists) && row.canonical_artists.length
            ? row.canonical_artists
            : Array.isArray(track?.canonical_artists) && track.canonical_artists.length
              ? track.canonical_artists
              : canonicalKkboxArtists(`${row?.artist_name || track?.artist_name || ''} ${row?.artist_roles || track?.artist_roles || ''}`),
        );
        return {
          track_id: String(row?.service_track_id || ''),
          rank: Number(row?.position),
          previous_rank: Number(row?.previous_position) || null,
          canonical_artists: canonicalArtists,
          title: track?.title ?? null,
          artist_name: row?.artist_name ?? track?.artist_name ?? null,
          artist_roles: row?.artist_roles ?? track?.artist_roles ?? null,
          album_name: track?.album_name ?? null,
          track_url: track?.track_url ?? null,
        };
      })
      .filter((row) => row.track_id && Number.isFinite(row.rank) && row.rank > 0 && row.canonical_artists.length)
      .sort((a, b) => a.rank - b.rank);

    records.push({
      territory,
      period_type: periodType,
      chart_type: chartType,
      requested_date: dateOnly(playlist?.requested_date || playlist?.provider_date || snapshot?.day),
      period: dateOnly(playlist?.provider_date || snapshot?.day),
      status: 'ok',
      source_url: playlist?.playlist_url ?? null,
      source_rows: Number(playlist?.source_rows) || 0,
      entries,
    });
  }
  return records;
}

export function mergeKkboxJapaneseHistory(existing = null, records = [], updatedAt = Date.now()) {
  const periodMap = new Map((Array.isArray(existing?.periods) ? existing.periods : []).map((row) => [recordKey(row), row]));
  for (const record of records) periodMap.set(recordKey(record), periodSummary(record));

  const replacedPeriods = new Set(records
    .filter((record) => record?.period)
    .map((record) => [record.territory, record.period_type, record.chart_type, record.period].join('|')));
  const historyMap = new Map();
  for (const row of Array.isArray(existing?.history) ? existing.history : []) {
    if (!currentGroupEntry(row)) continue;
    const periodKey = [row.territory, row.period_type, row.chart_type, row.period].join('|');
    if (!replacedPeriods.has(periodKey)) {
      const currentRow = { ...row, canonical_artists: currentCanonicalArtists(row.canonical_artists) };
      historyMap.set(historyKey(currentRow), currentRow);
    }
  }
  for (const record of records) {
    for (const entry of Array.isArray(record?.entries) ? record.entries.filter(currentGroupEntry) : []) {
      const row = rowFromRecord(record, entry);
      if (row.period && row.track_id && row.canonical_artists.length && Number.isFinite(row.rank) && row.rank > 0) {
        historyMap.set(historyKey(row), row);
      }
    }
  }

  const history = [...historyMap.values()].sort(sortHistory);
  const periods = [...periodMap.values()].map((row) => ({
    ...row,
    entries: row?.period
      ? history.filter((item) => item.territory === row.territory
        && item.period_type === row.period_type
        && item.chart_type === row.chart_type
        && item.period === row.period).length
      : 0,
  })).sort(sortPeriods);
  const successful = periods.filter((row) => row.status === 'ok');
  const failed = periods.filter((row) => row.status !== 'ok');
  const series = {};
  for (const key of ['tw/daily/song', 'tw/daily/newrelease', 'tw/weekly/song', 'tw/weekly/newrelease',
    'hk/daily/song', 'hk/daily/newrelease', 'hk/weekly/song', 'hk/weekly/newrelease']) {
    const checked = successful.filter((row) => seriesKey(row) === key);
    const matches = history.filter((row) => seriesKey(row) === key);
    series[key] = {
      checked_requests: checked.length,
      earliest_period: checked.map((row) => row.period).filter(Boolean).sort()[0] ?? null,
      latest_period: checked.map((row) => row.period).filter(Boolean).sort().at(-1) ?? null,
      entries: matches.length,
    };
  }

  return {
    version: 1,
    service: 'kkbox',
    chart: 'japanese',
    category: KKBOX_JAPANESE_CATEGORY,
    updated_at: Number(updatedAt) || Date.now(),
    coverage: {
      checked_requests: successful.length,
      failed_requests: failed.length,
      entries: history.length,
      series,
    },
    periods,
    history,
  };
}

export async function upsertKkboxJapaneseHistoryArtifacts({ load, save, records, updatedAt = Date.now() }) {
  const existing = await load(KKBOX_JAPANESE_HISTORY_VIEW_KEY);
  const next = mergeKkboxJapaneseHistory(existing, Array.isArray(records) ? records : [], updatedAt);
  const before = JSON.stringify({
    periods: existing?.periods || [],
    history: existing?.history || [],
  });
  const after = JSON.stringify({ periods: next.periods, history: next.history });
  if (before === after) return { changed: false, view: existing || next };
  await save(KKBOX_JAPANESE_HISTORY_VIEW_KEY, next);
  return { changed: true, view: next };
}
