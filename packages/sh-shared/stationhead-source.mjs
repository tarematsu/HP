const SOURCE_ALIASES = Object.freeze({
  buddies: 'buddies',
  buddy46: 'buddies',
  sakurazaka: 'buddies',
  ohisama: 'ohisama',
  hinata: 'ohisama',
  hinatazaka: 'ohisama',
  nogizaka: 'nogizaka',
  nogizaka46smej: 'nogizaka',
});

export const STATIONHEAD_SOURCE_PROFILES = Object.freeze({
  buddies: Object.freeze({
    source: 'buddies',
    channelAlias: 'buddies',
    dbBinding: 'BUDDIES_DB',
    modelKey: 'dashboard',
    playbackHotKey: 'stationhead/buddies/playback-state.json',
    readModelHotKey: 'stationhead/buddies/dashboard-hot-state.json',
  }),
  ohisama: Object.freeze({
    source: 'ohisama',
    channelAlias: 'ohisama',
    dbBinding: 'OHISAMA_DB',
    modelKey: 'hinata',
    playbackHotKey: 'stationhead/ohisama/playback-state.json',
    readModelHotKey: 'stationhead/ohisama/read-model-hot-state.json',
  }),
  nogizaka: Object.freeze({
    source: 'nogizaka',
    channelAlias: 'nogizaka46smej',
    dbBinding: 'OTHER_DB',
    modelKey: 'nogizaka-listening-party',
    playbackHotKey: 'stationhead/nogizaka/playback-state.json',
    readModelHotKey: 'stationhead/nogizaka/read-model-hot-state.json',
  }),
});

export function normalizeStationheadSource(value) {
  const key = String(value || '').trim().toLowerCase();
  return SOURCE_ALIASES[key] || null;
}

export function stationheadSourceProfile(value) {
  const source = normalizeStationheadSource(value);
  return source ? STATIONHEAD_SOURCE_PROFILES[source] : null;
}

export function requireStationheadSourceProfile(value) {
  const profile = stationheadSourceProfile(value);
  if (!profile) throw new Error(`unsupported Stationhead source: ${String(value || '<empty>')}`);
  return profile;
}
