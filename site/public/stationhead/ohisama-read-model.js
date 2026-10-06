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
      const payload = await fetchJson('/api/track-history?source=ohisama&dates_only=1', options);
      return (Array.isArray(payload?.dates) ? payload.dates : [])
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
        .sort();
    },
    async loadPlayedPeriod(from, to, options) {
      const payload = await fetchJson(
        `/api/track-history?source=ohisama&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=10000&ranking=0`,
        options,
      );
      return normalizePlayedRows(payload.rows);
    },
    async loadLikes(options) {
      let rows;
      try {
        const payload = await fetchJson(
          '/api/track-history?source=ohisama&ranking_only=1&ranking_limit=500',
          options,
        );
        rows = payload.ranking;
      } catch {
        // Transitional compatibility for PR assets running against a pre-source API deployment.
        rows = (await all(options)).likes;
      }
      return normalizeLikes(rows)
        .filter((row) => !row.artist || row.artist.normalize('NFKC').includes('日向坂46'));
    },
    async loadBroadcasts() { return { rows: [], series: [], collection_active: false }; },
  };
}
