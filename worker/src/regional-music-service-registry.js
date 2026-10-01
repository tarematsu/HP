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

// `metrics` describes data the current collector actually persists. The broader
// discovery/expansion targets remain documented separately in the implementation plan.
export const REGIONAL_MUSIC_SERVICES = Object.freeze({
  genie: Object.freeze({ region: 'KR', phase: 1, metrics: ['artist_likes', 'track_plays', 'track_listeners', 'track_likes', 'catalog'] }),
  bugs: Object.freeze({ region: 'KR', phase: 1, metrics: ['artist_likes'] }),
  joox: Object.freeze({ region: 'HK/TH/SEA', phase: 1, metrics: ['artist_followers'] }),
  nhaccuatui: Object.freeze({ region: 'VN', phase: 1, metrics: ['artist_followers', 'track_plays'] }),
  anghami: Object.freeze({ region: 'MENA', phase: 1, metrics: ['artist_followers', 'track_plays', 'track_likes'] }),
  qq_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog', 'rankings'] }),
  netease_cloud_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog', 'comments', 'rankings'] }),
  kugou_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog'] }),
  melon: Object.freeze({ region: 'KR', phase: 2, metrics: ['artist_followers', 'catalog', 'playlists'] }),
  naver_vibe: Object.freeze({ region: 'KR', phase: 2, metrics: ['artist_likes', 'track_likes', 'catalog'] }),
  flo: Object.freeze({ region: 'KR', phase: 2, metrics: ['catalog'] }),
  yandex_music: Object.freeze({ region: 'RU/CIS', phase: 3, metrics: ['catalog'] }),
  boomplay: Object.freeze({ region: 'Africa', phase: 3, metrics: ['catalog'] }),
  plern: Object.freeze({ region: 'TH', phase: 3, metrics: ['catalog'] }),
  fungjai: Object.freeze({ region: 'TH', phase: 3, metrics: ['catalog'] }),
  zing_mp3: Object.freeze({ region: 'VN', phase: 3, metrics: ['catalog'] }),
  jiosaavn: Object.freeze({ region: 'IN', phase: 3, metrics: ['catalog'] }),
  gaana: Object.freeze({ region: 'IN', phase: 3, metrics: ['catalog', 'rankings'] }),
  langit_musik: Object.freeze({ region: 'ID', phase: 3, metrics: ['catalog'] }),
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
