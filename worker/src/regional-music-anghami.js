import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { parseCompactCount, visibleHtmlText } from './regional-music-html.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

export const ANGHAMI_SEED_TRACKS = Object.freeze({
  sakurazaka46: Object.freeze({ id: '1234315551', title: 'Buddies (English Version)' }),
  hinatazaka46: Object.freeze({ id: '1175424536', title: 'Sabitsukanaiken wo mote! off vocal version' }),
  nogizaka46: Object.freeze({ id: '1248908439', title: 'kangaenaiyounisuru' }),
});

export function anghamiSongUrl(trackId) {
  return `https://play.anghami.com/song/${encodeURIComponent(trackId)}`;
}

export function anghamiArtistUrl(artistId) {
  return `https://play.anghami.com/artist/${encodeURIComponent(artistId)}`;
}

function metric(text, label) {
  const match = String(text || '').match(new RegExp(`([0-9][0-9,.]*[KMB]?)\\s+${label}`, 'i'));
  return parseCompactCount(match?.[1]);
}

export function parseAnghamiTrackMetrics(html) {
  const text = visibleHtmlText(html);
  return {
    plays: metric(text, 'Plays?'),
    likes: metric(text, 'Likes?'),
  };
}

export function parseAnghamiArtistMetrics(html) {
  const text = visibleHtmlText(html);
  return {
    followers: metric(text, 'Followers?'),
    plays: metric(text, 'Plays?'),
  };
}

export function findAnghamiArtistId(html, artistName) {
  const source = String(html || '');
  const anchors = source.matchAll(/<a\b[^>]*href=["'][^"']*\/artist\/(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi);
  const wanted = String(artistName || '').toLocaleLowerCase('en-US');
  for (const match of anchors) {
    if (visibleHtmlText(match[2]).toLocaleLowerCase('en-US').includes(wanted)) return match[1];
  }
  return null;
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectAnghami(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let tracks = 0;
  let artists = 0;

  for (const [canonicalArtist, seed] of Object.entries(ANGHAMI_SEED_TRACKS)) {
    const artistName = REGIONAL_MUSIC_ARTISTS[canonicalArtist].displayName.replace('櫻坂46', 'Sakurazaka46')
      .replace('日向坂46', 'Hinatazaka46').replace('乃木坂46', 'Nogizaka46');
    const trackUrl = anghamiSongUrl(seed.id);
    try {
      const trackHtml = await fetchHtml(fetchImpl, trackUrl);
      const trackMetrics = parseAnghamiTrackMetrics(trackHtml);
      const artistId = findAnghamiArtistId(trackHtml, artistName);
      await saveRegionalTrack(env, {
        service: 'anghami',
        service_track_id: seed.id,
        service_artist_id: artistId,
        canonical_artist: canonicalArtist,
        title: seed.title,
        track_url: trackUrl,
        plays: trackMetrics.plays,
        likes: trackMetrics.likes,
        observed_at: observedAt,
      });
      tracks += 1;

      if (artistId) {
        const profileUrl = anghamiArtistUrl(artistId);
        const artistHtml = await fetchHtml(fetchImpl, profileUrl);
        const artistMetrics = parseAnghamiArtistMetrics(artistHtml);
        await saveRegionalArtist(env, {
          service: 'anghami',
          canonical_artist: canonicalArtist,
          service_artist_id: artistId,
          display_name: artistName,
          profile_url: profileUrl,
          followers: artistMetrics.followers,
          observed_at: observedAt,
        });
        artists += 1;
      }
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (tracks || artists) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'anghami',
    status,
    last_attempt_at: observedAt,
    last_success_at: (tracks || artists) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'anghami', status, artists, tracks, failures };
}
