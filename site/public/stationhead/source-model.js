// Source adapters declare only upstream read-model endpoints and available data.
// All Stationhead channels share presentation, normalization and navigation.
import { fetchJson } from './data-client.js';
import { createStationheadTrackHistoryClient } from './track-history-client.js';
import { normalizeCurrent, normalizedDaily, historyMode, normalizeBroadcasts } from './normalize.js';

export function createStationheadChannelModel({
  source, stationUrl, artistFilter, capabilities,
  currentUrl = null, historyUrl = null, historyRows = (payload, mode) => payload?.[mode],
  broadcastLoader = null,
}) {
  let selectedHistoryMode = 'daily';
  const features = [...capabilities];
  const tracks = features.some((item) => item === 'played-tracks' || item === 'likes')
    ? createStationheadTrackHistoryClient(source, artistFilter, fetchJson)
    : null;
  return {
    source,
    meta: { station_url: stationUrl, artist_filter: artistFilter },
    capabilities: features,
    async loadCurrent(options = {}) {
      if (!currentUrl) return normalizeCurrent({});
      return normalizeCurrent(await fetchJson(currentUrl, options));
    },
    setHistoryMode(mode) { selectedHistoryMode = historyMode(mode); },
    async loadHistory(options = {}) {
      if (!historyUrl) return { daily: [], mode: selectedHistoryMode };
      const mode = selectedHistoryMode;
      const payload = await fetchJson(historyUrl(mode), options);
      return { daily: normalizedDaily(historyRows(payload, mode)), mode };
    },
    loadPlayedIndex: tracks?.loadIndex || (async () => []),
    loadPlayedPeriod: tracks?.loadPeriod || (async () => []),
    loadLikes: tracks?.loadLikes || (async () => []),
    async loadBroadcasts(options = {}) {
      return broadcastLoader ? normalizeBroadcasts(await broadcastLoader(options)) : normalizeBroadcasts({});
    },
  };
}
