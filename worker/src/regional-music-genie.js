import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { visibleHtmlText } from './regional-music-html.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const GENIE_TRACK_BATCH = 5;

export function genieSearchUrl(query) {
  return `https://www.genie.co.kr/search/searchMain?query=${encodeURIComponent(query)}`;
}

export function genieArtistUrl(artistId) {
  return `https://www.genie.co.kr/detail/artistInfo?xxnm=${encodeURIComponent(artistId)}`;
}

export function genieSongUrl(trackId) {
  return `https://www.genie.co.kr/detail/songInfo?xgnm=${encodeURIComponent(trackId)}`;
}

function number(value) {
  if (!value) return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

export function findGenieArtistId(html, aliases) {
  const source = String(html || '');
  const links = source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  const wanted = aliases.map((alias) => String(alias).normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ''));
  for (const match of links) {
    const label = visibleHtmlText(match[2]).normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
    const id = match[1].match(/artistInfo\?xxnm=(\d+)|fnViewArtist\(\s*['"]?(\d+)/i);
    if (wanted.includes(label) && id) return id[1] || id[2];
  }
  return null;
}

export function extractGenieTrackIds(html, limit = GENIE_TRACK_BATCH) {
  const ids = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/(?:songInfo\?xgnm=|fnViewSongInfo\(\s*['"]?)(\d+)/gi)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    ids.push(match[1]);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function parseGenieArtistLikes(html) {
  const text = visibleHtmlText(html);
  return number(text.match(/좋아요!\s*([0-9][0-9,]*)/u)?.[1]);
}

export function parseGenieTrackMetrics(html) {
  const text = visibleHtmlText(String(html || '').replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' $1 '));
  const likes = number(text.match(/좋아요!\s*([0-9][0-9,]*)/u)?.[1]);
  const listeners = number(text.match(/([0-9][0-9,]*)\s*전체 청취자수/u)?.[1]);
  const plays = number(text.match(/([0-9][0-9,]*)\s*전체 재생수/u)?.[1]);
  return { likes, listeners, plays };
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.6',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function discoverGenieArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const html = await fetchHtml(fetchImpl, genieSearchUrl(alias));
    const artistId = findGenieArtistId(html, artist.aliases);
    if (artistId) return artistId;
  }
  return null;
}

export async function collectGenie(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const artistId = await discoverGenieArtist(fetchImpl, artist);
      if (!artistId) throw new Error('artist id not found');
      const profileUrl = genieArtistUrl(artistId);
      const profileHtml = await fetchHtml(fetchImpl, profileUrl);
      await saveRegionalArtist(env, {
        service: 'genie',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: artist.aliases[1],
        profile_url: profileUrl,
        likes: parseGenieArtistLikes(profileHtml),
        observed_at: observedAt,
      });
      artists += 1;

      for (const [index, trackId] of extractGenieTrackIds(profileHtml).entries()) {
        try {
          const trackUrl = genieSongUrl(trackId);
          const songHtml = await fetchHtml(fetchImpl, trackUrl);
          if (findGenieArtistId(songHtml, artist.aliases) !== artistId) throw new Error('song artist identity could not be verified');
          const metrics = parseGenieTrackMetrics(songHtml);
          await saveRegionalTrack(env, {
            service: 'genie',
            service_track_id: trackId,
            service_artist_id: artistId,
            canonical_artist: canonicalArtist,
            track_url: trackUrl,
            popularity_rank: index + 1,
            popularity_rank_source: 'artist_page_order',
            likes: metrics.likes,
            listeners: metrics.listeners,
            plays: metrics.plays,
            observed_at: observedAt,
          });
          tracks += 1;
        } catch (error) {
          failures.push({ canonical_artist: canonicalArtist, track_id: trackId, error: String(error?.message || error) });
        }
      }
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'genie',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'genie', status, artists, tracks, failures };
}
