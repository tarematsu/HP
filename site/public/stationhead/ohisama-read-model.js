// ohisama API adapter and capabilities.
import { fetchJson } from './data-client.js';
import { normalizeCurrent, normalizedDaily, historyMode, normalizePlayedRows, normalizeLikes } from './normalize.js';

export function ohisamaModel() {
  const all = (options = {}) => fetchJson('/api/hinata', options);
  let selectedHistoryMode = 'daily';
  return {
    source: 'ohisama',
    meta: { station_url: 'https://stationhead.com/c/ohisama', artist_filter: '日向坂46' },
    capabilities: ['current', 'history', 'played-tracks', 'likes'],
    async loadCurrent(options) { return normalizeCurrent(await all(options)); },
    setHistoryMode(mode) { selectedHistoryMode = historyMode(mode); },
    async loadHistory(options) {
      const payload = await all(options);
      const mode = selectedHistoryMode;
      return { daily: normalizedDaily(payload?.[mode]), mode };
    },
    async loadPlayedIndex(options) {
      const payload = await all(options);
      return (Array.isArray(payload?.played_history) ? payload.played_history : [])
        .map((row) => String(row?.period_key || ''))
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .sort();
    },
    async loadPlayedPeriod(from, to, options) {
      const payload = await all(options);
      const rows = Array.isArray(payload?.played_history) ? payload.played_history : [];
      return rows.filter((row) => String(row?.period_key || '') >= from && String(row?.period_key || '') <= to)
        .flatMap((row) => normalizePlayedRows(row?.tracks));
    },
    async loadLikes(options) {
      const payload = await all(options);
      return normalizeLikes(payload.likes).filter((row) => !row.artist || row.artist.normalize('NFKC').includes('日向坂46'));
    },
    async loadBroadcasts() { return { rows: [], series: [], collection_active: false }; },
  };
}
