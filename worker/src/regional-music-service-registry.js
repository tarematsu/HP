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

export const REGIONAL_MUSIC_SERVICES = Object.freeze({
  genie: Object.freeze({ region: 'KR', phase: 1, metrics: ['track_plays', 'track_listeners', 'track_likes', 'catalog'] }),
  bugs: Object.freeze({ region: 'KR', phase: 1, metrics: ['artist_likes', 'catalog', 'playlists'] }),
  joox: Object.freeze({ region: 'HK/TH/SEA', phase: 1, metrics: ['artist_followers', 'catalog', 'rankings', 'comments', 'playlists'] }),
  nhaccuatui: Object.freeze({ region: 'VN', phase: 1, metrics: ['artist_followers', 'catalog', 'playlists'] }),
  anghami: Object.freeze({ region: 'MENA', phase: 1, metrics: ['track_plays', 'track_likes', 'catalog', 'playlists'] }),
  qq_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['artist_followers', 'catalog', 'rankings', 'comments', 'playlists'] }),
  netease_cloud_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['artist_followers', 'catalog', 'comments', 'rankings', 'playlists'] }),
  kugou_music: Object.freeze({ region: 'CN', phase: 2, metrics: ['catalog', 'rankings', 'playlists'] }),
  melon: Object.freeze({ region: 'KR', phase: 2, metrics: ['track_likes', 'catalog', 'rankings', 'playlists'] }),
  naver_vibe: Object.freeze({ region: 'KR', phase: 2, metrics: ['artist_likes', 'track_likes', 'catalog', 'rankings', 'playlists'] }),
  flo: Object.freeze({ region: 'KR', phase: 2, metrics: ['catalog', 'rankings', 'playlists'] }),
  yandex_music: Object.freeze({ region: 'RU/CIS', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
  boomplay: Object.freeze({ region: 'Africa', phase: 3, metrics: ['track_plays', 'track_likes', 'comments', 'catalog', 'playlists'] }),
  plern: Object.freeze({ region: 'TH', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
  fungjai: Object.freeze({ region: 'TH', phase: 3, metrics: ['catalog', 'playlists'] }),
  zing_mp3: Object.freeze({ region: 'VN', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
  jiosaavn: Object.freeze({ region: 'IN', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
  gaana: Object.freeze({ region: 'IN', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
  langit_musik: Object.freeze({ region: 'ID', phase: 3, metrics: ['catalog', 'rankings', 'playlists'] }),
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
