// nogizaka API adapter and capabilities.
import { fetchJson } from './data-client.js';
import { historyMode, normalizeBroadcasts } from './normalize.js';

export function nogizakaModel() {
  let selectedHistoryMode = 'daily';
  return {
    source: 'nogizaka',
    meta: { station_url: 'https://stationhead.com/c/nogizaka46smej', artist_filter: '乃木坂46' },
    capabilities: ['broadcasts'],
    async loadCurrent() { return { latest: {}, history_24h: [], previous_day_history: [], queue: [], queue_status: null }; },
    setHistoryMode(mode) { selectedHistoryMode = historyMode(mode); },
    async loadHistory() { return { daily: [], mode: selectedHistoryMode }; },
    async loadPlayedIndex() { return []; },
    async loadPlayedPeriod() { return []; },
    async loadLikes() { return []; },
    async loadBroadcasts(options) { return normalizeBroadcasts(await fetchJson('/api/nogizaka-listening-party', options)); },
  };
}
