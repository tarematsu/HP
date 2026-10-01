import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { visibleHtmlText } from './regional-music-html.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalPlaylist,
  saveRegionalPlaylistMembership,
  saveRegionalPlaylistSnapshot,
  saveRegionalTrack,
} from './regional-music-store.js';

const MELON_PLAYLISTS = Object.freeze([
  Object.freeze({
    id: '430097431',
    name: '역대 오리콘 차트 명곡',
    type: 'editorial',
    owner: 'ETC마스터',
  }),
]);

export function melonSearchUrl(query) {
  return `https://www.melon.com/search/total/index.htm?q=${encodeURIComponent(query)}`;
}

export function melonArtistUrl(artistId) {
  return `https://www.melon.com/artist/detail.htm?artistId=${encodeURIComponent(artistId)}`;
}

export function melonPlaylistUrl(playlistId) {
  return `https://www.melon.com/m6/landing/djplayList.htm?plylstSeq=${encodeURIComponent(playlistId)}&type=djc`;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function number(value) {
  if (!value) return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

export function findMelonArtistId(html, aliases) {
  const source = String(html || '');
  const wanted = aliases.map(normalize);
  const links = source.matchAll(/<a\b[^>]*(?:goArtistDetail\(['"]?(\d+)['"]?\)|artistId=(\d+))[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const label = normalize(visibleHtmlText(match[3]));
    if (wanted.includes(label)) return match[1] || match[2];
  }
  return null;
}

export function parseMelonFollowers(html) {
  const text = visibleHtmlText(html);
  return number(text.match(/팬맺기\s*([0-9][0-9,]*)/u)?.[1]);
}

function rowTrackId(row) {
  return row.match(/data-song-no=["'](\d+)["']/i)?.[1]
    || row.match(/goSongDetail\(['"]?(\d+)['"]?\)/i)?.[1]
    || row.match(/songId=(\d+)/i)?.[1]
    || null;
}

function rowTitle(row) {
  const ranked = row.match(/class=["'][^"']*rank01[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if (ranked) return visibleHtmlText(ranked[1]) || null;
  const title = row.match(/title=["']([^"']+)["']/i)?.[1];
  return title ? visibleHtmlText(title) : null;
}

function rowPosition(row) {
  const explicit = row.match(/class=["'][^"']*(?:rank|num)[^"']*["'][^>]*>\s*(\d+)\s*</i)?.[1];
  return number(explicit);
}

export function parseMelonPlaylistEntries(html) {
  const rows = String(html || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const entries = [];
  for (const row of rows) {
    const trackId = rowTrackId(row);
    if (!trackId) continue;
    const text = visibleHtmlText(row);
    const canonicalArtist = Object.entries(REGIONAL_MUSIC_ARTISTS).find(([, artist]) =>
      artist.aliases.some((alias) => normalize(text).includes(normalize(alias))))?.[0] || null;
    if (!canonicalArtist) continue;
    entries.push({
      track_id: trackId,
      canonical_artist: canonicalArtist,
      title: rowTitle(row),
      position: rowPosition(row),
    });
  }
  return entries;
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function discoverMelonArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const html = await fetchHtml(fetchImpl, melonSearchUrl(alias));
    const id = findMelonArtistId(html, artist.aliases);
    if (id) return id;
  }
  return null;
}

export async function collectMelon(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;
  let memberships = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const artistId = await discoverMelonArtist(fetchImpl, artist);
      if (!artistId) throw new Error('artist id not found');
      const profileUrl = melonArtistUrl(artistId);
      const html = await fetchHtml(fetchImpl, profileUrl);
      await saveRegionalArtist(env, {
        service: 'melon',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: artist.aliases[1],
        profile_url: profileUrl,
        followers: parseMelonFollowers(html),
        observed_at: observedAt,
      });
      artists += 1;
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  for (const playlist of MELON_PLAYLISTS) {
    try {
      const playlistUrl = melonPlaylistUrl(playlist.id);
      const html = await fetchHtml(fetchImpl, playlistUrl);
      const entries = parseMelonPlaylistEntries(html);
      await saveRegionalPlaylist(env, {
        service: 'melon',
        service_playlist_id: playlist.id,
        playlist_name: playlist.name,
        playlist_url: playlistUrl,
        playlist_type: playlist.type,
        owner_name: playlist.owner,
        observed_at: observedAt,
      });
      await saveRegionalPlaylistSnapshot(env, {
        service: 'melon',
        service_playlist_id: playlist.id,
        item_count: entries.length,
        observed_at: observedAt,
      });
      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'melon',
          service_track_id: entry.track_id,
          canonical_artist: entry.canonical_artist,
          title: entry.title,
          observed_at: observedAt,
        });
        await saveRegionalPlaylistMembership(env, {
          service: 'melon',
          service_playlist_id: playlist.id,
          service_track_id: entry.track_id,
          position: entry.position,
          observed_at: observedAt,
        });
        tracks += 1;
        memberships += 1;
      }
    } catch (error) {
      failures.push({ playlist_id: playlist.id, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'melon',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, playlist_memberships: memberships, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'melon', status, artists, tracks, playlist_memberships: memberships, failures };
}
