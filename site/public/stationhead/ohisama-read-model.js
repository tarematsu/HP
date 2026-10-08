// ohisama API adapter and capabilities.
import { fetchJson } from './data-client.js';
import { createStationheadTrackHistoryClient } from './track-history-client.js';
import { normalizeCurrent, normalizedDaily, historyMode } from './normalize.js';

export function ohisamaModel() {
  const all = (options = {}) => fetchJson('/api/hinata', options);
  let selectedHistoryMode = 'daily';
  const tracks = createStationheadTrackHistoryClient('ohisama', '日向坂46', fetchJson);
  return {
    source: 'ohisama',
    meta: { station_url: 'https://stationhead.com/c/ohisama', artist_filter: '日向坂46' },
    capabilities: ['current', 'history', 'played-tracks', 'likes'],
    async loadCurrent(options) { return normalizeCurrent(await all(options)); },
    setHistoryMode(mode) { selectedHistoryMode = historyMode(mode); },
    async loadHistory(options) {
      const mode = selectedHistoryMode;
      const payload = await all(options);
      return { daily: normalizedDaily(payload?.[mode]), mode };
    },
    loadPlayedIndex: tracks.loadIndex,
    loadPlayedPeriod: tracks.loadPeriod,
    loadLikes: tracks.loadLikes,
    async loadBroadcasts() { return { rows: [], series: [], collection_active: false }; },
  };
}
