// buddies API adapter and capabilities.
import { fetchJson, todayUtc } from './data-client.js';
import { normalizeCurrent, normalizedDaily, historyMode, normalizePlayedRows, normalizeLikes, normalizeBroadcasts } from './normalize.js';

export function buddiesModel() {
  let selectedHistoryMode = 'daily';
  return {
    source: 'buddies',
    meta: { station_url: 'https://stationhead.com/c/buddies', artist_filter: '櫻坂46' },
    capabilities: ['current', 'history', 'played-tracks', 'likes', 'broadcasts'],
    async loadCurrent({ signal = null, force = false } = {}) {
      return normalizeCurrent(await fetchJson('/api/dashboard?history=0', { signal, force }));
    },
    setHistoryMode(mode) { selectedHistoryMode = historyMode(mode); },
    async loadHistory({ signal = null, force = false } = {}) {
      const mode = selectedHistoryMode;
      const payload = await fetchJson(`/api/history?mode=${mode}&from=2024-06-01&to=${todayUtc()}`, { signal, force });
      return { daily: normalizedDaily(payload.rows), mode };
    },
    async loadPlayedIndex({ signal = null, force = false } = {}) {
      const payload = await fetchJson('/api/track-history?dates_only=1', { signal, force });
      return (Array.isArray(payload?.dates) ? payload.dates : []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).sort();
    },
    async loadPlayedPeriod(from, to, { signal, force } = {}) {
      const payload = await fetchJson(`/api/track-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=10000&ranking=0`, { signal, force });
      return normalizePlayedRows(payload.rows);
    },
    async loadLikes({ signal = null, force = false } = {}) {
      const payload = await fetchJson('/api/track-history?ranking_only=1&ranking_limit=500', { signal, force });
      return normalizeLikes(payload.ranking).filter((row) => !row.artist || row.artist.normalize('NFKC').includes('櫻坂46'));
    },
    async loadBroadcasts({ signal = null, force = false } = {}) {
      const summary = await fetchJson(`/api/history?mode=broadcasts&from=2024-06-01&to=${todayUtc()}`, { signal, force });
      const normalized = normalizeBroadcasts(summary);
      try {
        const chart = await fetchJson(`/api/sakurazaka46jp?from=2024-06-01&to=${todayUtc()}&revision=3`, { signal, force });
        normalized.series = Array.isArray(chart.series) ? chart.series : [];
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        normalized.chart_error = true;
      }
      return normalized;
    },
  };
}
