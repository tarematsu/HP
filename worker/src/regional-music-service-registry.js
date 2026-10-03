export const REGIONAL_MUSIC_ARTISTS = Object.freeze({
  sakurazaka46: Object.freeze({
    displayName: '櫻坂46',
    aliases: Object.freeze(['櫻坂46', 'Sakurazaka46', 'SAKURAZAKA46']),
  }),
  hinatazaka46: Object.freeze({
    displayName: '日向坂46',
    aliases: Object.freeze(['日向坂46', 'Hinatazaka46', 'HINATAZAKA46']),
  }),
  nogizaka46: Object.freeze({
    displayName: '乃木坂46',
    aliases: Object.freeze(['乃木坂46', 'Nogizaka46', 'NOGIZAKA46']),
  }),
});

// 青葉坂46 is intentionally YouTube Music-only. Keep the regional/local
// providers on the original three-group target set so their collection cost
// and matching semantics do not change.
export const YOUTUBE_MUSIC_ARTISTS = Object.freeze({
  ...REGIONAL_MUSIC_ARTISTS,
  aobazaka46: Object.freeze({
    displayName: '青葉坂46',
    aliases: Object.freeze(['青葉坂46', 'Aobazaka46', 'AOBAZAKA46']),
  }),
});

// `metrics` describes data the current collector actually persists. The broader
// discovery/expansion targets remain documented separately in the implementation plan.
export const REGIONAL_MUSIC_SERVICES = Object.freeze({
  youtube_music: Object.freeze({ region: 'JP/Global', phase: 1, metrics: ['artist_followers', 'monthly_audience', 'total_views', 'catalog', 'releases', 'playlists'] }),
  qq_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog', 'rankings'] }),
  kugou_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog', 'rankings'] }),
  kkbox: Object.freeze({ region: 'TW/HK', phase: 2, metrics: ['catalog', 'rankings'] }),
});

const aliasLookup = new Map();
for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
  for (const alias of artist.aliases) aliasLookup.set(normalizeArtistAlias(alias), canonicalArtist);
}

export function normalizeArtistAlias(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replaceAll(/\s+/g, '');
}

export function canonicalRegionalArtist(value) {
  return aliasLookup.get(normalizeArtistAlias(value)) || null;
}

export function regionalMusicService(name) {
  return REGIONAL_MUSIC_SERVICES[String(name || '')] || null;
}

export function regionalMusicServicesByPhase(phase) {
  const numericPhase = Number(phase);
  return Object.entries(REGIONAL_MUSIC_SERVICES)
    .filter(([, definition]) => definition.phase === numericPhase)
    .map(([name]) => name);
}

export function regionalMusicCollectionPlan() {
  return Object.entries(REGIONAL_MUSIC_SERVICES).map(([service, definition]) => ({
    service,
    region: definition.region,
    phase: definition.phase,
    metrics: [...definition.metrics],
  }));
}
