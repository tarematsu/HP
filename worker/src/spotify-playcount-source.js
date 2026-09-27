import {
  SPOTIFY_TARGET_ARTISTS,
  integer,
  safeText,
  truncateError,
} from './spotify-playcount-common.js';

const SPOTIFY_EMBED_ARTIST_BASE = 'https://open.spotify.com/embed/artist/';
const SPOTIFY_PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const PUBLIC_PAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const ARTIST_DISCOGRAPHY_HASH = '9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0';
const ALBUM_TRACKS_HASH = '3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e';
const DISCOGRAPHY_PAGE_LIMIT = 100;
const ALBUM_TRACK_LIMIT = 300;

export function parseSpotifyEmbedSession(html) {
  const match = String(html || '').match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) throw new Error('Spotify embed __NEXT_DATA__ was not found');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Spotify embed __NEXT_DATA__ decode failed: ${truncateError(error, 300)}`);
  }
  const session = data?.props?.pageProps?.state?.settings?.session;
  const accessToken = safeText(session?.accessToken);
  if (!accessToken) throw new Error('Spotify anonymous web session token was not found');
  return {
    accessToken,
    accessTokenExpirationTimestampMs: integer(session?.accessTokenExpirationTimestampMs),
    isAnonymous: session?.isAnonymous !== false,
  };
}

async function responseText(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`);
  }
  return text;
}

export async function fetchAnonymousSession(env, fetchImpl = fetch) {
  const base = safeText(env?.SPOTIFY_EMBED_ARTIST_BASE, SPOTIFY_EMBED_ARTIST_BASE);
  const seedArtistId = SPOTIFY_TARGET_ARTISTS[1].spotify_artist_id;
  const response = await fetchImpl(`${base}${encodeURIComponent(seedArtistId)}`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
      'user-agent': PUBLIC_PAGE_USER_AGENT,
    },
  });
  return parseSpotifyEmbedSession(await responseText(response, 'Spotify public embed session'));
}

async function pathfinderQuery({ accessToken, operationName, variables, hash, fetchImpl, env }) {
  const url = new URL(safeText(env?.SPOTIFY_PATHFINDER_URL, SPOTIFY_PATHFINDER_URL));
  url.searchParams.set('operationName', operationName);
  url.searchParams.set('variables', JSON.stringify(variables));
  url.searchParams.set('extensions', JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: hash },
  }));
  const response = await fetchImpl(url.toString(), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': PUBLIC_PAGE_USER_AGENT,
    },
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(`Spotify ${operationName} failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Spotify ${operationName} returned invalid JSON`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const detail = payload.errors.map((entry) => safeText(entry?.message)).filter(Boolean).join('; ');
    throw new Error(`Spotify ${operationName} GraphQL error${detail ? `: ${detail.slice(0, 400)}` : ''}`);
  }
  return payload;
}

function spotifyIdFromUri(uri, type) {
  const prefix = `spotify:${type}:`;
  const value = safeText(uri);
  return value.startsWith(prefix) ? value.slice(prefix.length) : '';
}

function releaseDate(release) {
  const iso = safeText(release?.date?.isoString);
  if (iso) return iso.slice(0, 10);
  const year = integer(release?.date?.year);
  if (year == null) return '';
  const month = integer(release?.date?.month);
  const day = integer(release?.date?.day);
  return [
    String(year).padStart(4, '0'),
    month == null ? null : String(month).padStart(2, '0'),
    day == null ? null : String(day).padStart(2, '0'),
  ].filter(Boolean).join('-');
}

export function releasesFromArtistDiscography(payload) {
  const groups = payload?.data?.artistUnion?.discography?.all?.items;
  const byId = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const release of Array.isArray(group?.releases?.items) ? group.releases.items : []) {
      const albumId = safeText(release?.id) || spotifyIdFromUri(release?.uri, 'album');
      if (!albumId) continue;
      byId.set(albumId, {
        album_id: albumId,
        name: safeText(release?.name),
        album_type: safeText(release?.type).toLowerCase(),
        release_date: releaseDate(release),
        release_date_precision: safeText(release?.date?.precision).toLowerCase(),
        total_tracks: integer(release?.tracks?.totalCount),
      });
    }
  }
  return [...byId.values()];
}

export async function discoverArtistReleases(artist, env, session, fetchImpl = fetch) {
  const byId = new Map();
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const payload = await pathfinderQuery({
      accessToken: session.accessToken,
      operationName: 'queryArtistDiscographyAll',
      variables: { uri: `spotify:artist:${artist.spotify_artist_id}`, offset, limit: DISCOGRAPHY_PAGE_LIMIT },
      hash: ARTIST_DISCOGRAPHY_HASH,
      fetchImpl,
      env,
    });
    for (const release of releasesFromArtistDiscography(payload)) byId.set(release.album_id, release);
    const all = payload?.data?.artistUnion?.discography?.all;
    const itemCount = Array.isArray(all?.items) ? all.items.length : 0;
    const totalCount = integer(all?.totalCount);
    if (!itemCount) break;
    offset += itemCount;
    if ((totalCount != null && offset >= totalCount) || itemCount < DISCOGRAPHY_PAGE_LIMIT) break;
  }
  const releases = [...byId.values()];
  if (!releases.length) throw new Error(`Spotify discography returned no releases for ${artist.artist_key}`);
  return releases;
}

function artistIds(rawArtists) {
  const values = [];
  for (const entry of rawArtists || []) {
    const artist = entry?.artist || entry;
    const id = safeText(artist?.id) || spotifyIdFromUri(artist?.uri, 'artist');
    if (id) values.push({ id, name: safeText(artist?.profile?.name || artist?.name) });
  }
  return values;
}

export function normalizeAlbumTracks(payload, targets) {
  const targetBySpotifyId = new Map(
    (targets || []).map((target) => [safeText(target?.spotify_artist_id), target]).filter(([id]) => id),
  );
  const album = payload?.data?.albumUnion || payload?.data?.album || payload;
  const albumArtists = artistIds(album?.artists?.items || album?.artists);
  const normalized = [];
  for (const item of Array.isArray(album?.tracks?.items) ? album.tracks.items : []) {
    const rawTrack = item?.track || item;
    const id = safeText(rawTrack?.id) || spotifyIdFromUri(rawTrack?.uri, 'track');
    const playcount = integer(rawTrack?.playcount);
    if (!id || playcount == null || playcount < 0) continue;
    let artists = artistIds(rawTrack?.artists?.items || rawTrack?.artists);
    if (!artists.length) artists = albumArtists;
    const matchedTargets = artists.map(({ id: artistId }) => targetBySpotifyId.get(artistId)).filter(Boolean);
    if (!matchedTargets.length) continue;
    normalized.push({
      track_id: id,
      name: safeText(rawTrack?.name),
      playcount,
      disc_number: integer(rawTrack?.discNumber ?? rawTrack?.disc_number),
      track_number: integer(rawTrack?.trackNumber ?? rawTrack?.track_number),
      duration_ms: integer(rawTrack?.duration?.totalMilliseconds ?? rawTrack?.duration_ms ?? rawTrack?.durationMs),
      artists_json: JSON.stringify(artists),
      target_keys: [...new Set(matchedTargets.map((target) => target.artist_key))],
    });
  }
  return normalized;
}

export async function fetchAlbumPlaycountPayload(albumId, env, session, fetchImpl = fetch) {
  let offset = 0;
  let album = null;
  const items = [];
  for (let page = 0; page < 10; page += 1) {
    const payload = await pathfinderQuery({
      accessToken: session.accessToken,
      operationName: 'queryAlbumTracks',
      variables: { uri: `spotify:album:${albumId}`, offset, limit: ALBUM_TRACK_LIMIT },
      hash: ALBUM_TRACKS_HASH,
      fetchImpl,
      env,
    });
    const current = payload?.data?.album;
    if (!current || typeof current !== 'object') {
      throw new Error(`Spotify queryAlbumTracks returned no album for ${albumId}`);
    }
    if (!album) album = current;
    const pageItems = Array.isArray(current?.tracks?.items) ? current.tracks.items : [];
    items.push(...pageItems);
    const totalCount = integer(current?.tracks?.totalCount);
    if (!pageItems.length) break;
    offset += pageItems.length;
    if ((totalCount != null && offset >= totalCount) || pageItems.length < ALBUM_TRACK_LIMIT) break;
  }
  return { data: { album: { ...album, tracks: { ...(album?.tracks || {}), items } } } };
}
