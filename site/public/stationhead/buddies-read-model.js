// Buddies varies from other channels only in the published read-model paths.
import { fetchJson, todayUtc } from './data-client.js';
import { createStationheadChannelModel } from './source-model.js';

export function buddiesModel() {
  return createStationheadChannelModel({
    source: 'buddies',
    stationUrl: 'https://stationhead.com/c/buddies',
    artistFilter: '櫻坂46',
    capabilities: ['current', 'history', 'played-tracks', 'likes', 'broadcasts'],
    currentUrl: '/api/dashboard?history=0',
    historyUrl: (mode) => `/api/history?mode=${mode}&from=2024-06-01&to=${todayUtc()}`,
    historyRows: (payload) => payload?.rows,
    async broadcastLoader({ signal = null, force = false } = {}) {
      const summary = await fetchJson(`/api/history?mode=broadcasts&from=2024-06-01&to=${todayUtc()}`, { signal, force });
      try {
        const chart = await fetchJson(`/api/sakurazaka46jp?from=2024-06-01&to=${todayUtc()}&revision=3`, { signal, force });
        return { ...summary, series: Array.isArray(chart.series) ? chart.series : [] };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        return { ...summary, chart_error: true };
      }
    },
  });
}
