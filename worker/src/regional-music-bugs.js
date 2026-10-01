import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { saveRegionalArtist, saveRegionalCollectorState } from './regional-music-store.js';

export const BUGS_ARTISTS = Object.freeze({
  sakurazaka46: '80348696',
  hinatazaka46: '80329579',
  nogizaka46: '80192968',
});

export function bugsArtistUrl(artistId) {
  return `https://music.bugs.co.kr/artist/${encodeURIComponent(artistId)}`;
}

function integer(value) {
  if (!value) return null;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export function parseBugsArtistLikes(html) {
  const source = String(html || '');
  const match = source.match(/좋아(?:\s|&nbsp;|<[^>]+>)*([0-9][0-9,]*)/u);
  return integer(match?.[1]);
}

export async function collectBugsArtists(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let collected = 0;

  for (const [canonicalArtist, artistId] of Object.entries(BUGS_ARTISTS)) {
    const url = bugsArtistUrl(artistId);
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const likes = parseBugsArtistLikes(html);
      if (likes == null) throw new Error('artist likes not found');

      await saveRegionalArtist(env, {
        service: 'bugs',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: REGIONAL_MUSIC_ARTISTS[canonicalArtist].displayName,
        profile_url: url,
        likes,
        observed_at: observedAt,
      });
      collected += 1;
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = collected === Object.keys(BUGS_ARTISTS).length
    ? 'ok'
    : collected > 0 ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'bugs',
    status,
    last_attempt_at: observedAt,
    last_success_at: collected > 0 ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists: collected, failed_artists: failures.length },
    updated_at: observedAt,
  });

  return { service: 'bugs', status, artists: collected, failures };
}
