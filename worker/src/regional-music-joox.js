import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { parseCompactCount, visibleHtmlText } from './regional-music-html.js';
import { saveRegionalArtist, saveRegionalCollectorState } from './regional-music-store.js';

export const JOOX_ARTISTS = Object.freeze({
  sakurazaka46: 'l3RBNJqESiqw84k4wFKQig==',
  hinatazaka46: 'bBDS6Lsx44ux11K9H6vrKQ==',
  nogizaka46: 'rsJfY_jmYjJ3Jrn7pdgwhA==',
});

export function jooxArtistUrl(artistId) {
  return `https://www.joox.com/hk/artist/${encodeURIComponent(artistId)}`;
}

export function parseJooxFollowers(html) {
  const text = visibleHtmlText(html);
  const match = text.match(/([0-9][0-9,.]*\s*[KMB]?)\s*(?:粉絲|粉丝|ผู้ติดตาม|followers?)/i);
  return parseCompactCount(match?.[1]?.replace(/\s+/g, ''));
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-HK,zh;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectJooxArtists(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let collected = 0;

  for (const [canonicalArtist, artistId] of Object.entries(JOOX_ARTISTS)) {
    const profileUrl = jooxArtistUrl(artistId);
    try {
      const html = await fetchHtml(fetchImpl, profileUrl);
      const followers = parseJooxFollowers(html);
      if (followers == null) throw new Error('artist followers not found');
      await saveRegionalArtist(env, {
        service: 'joox',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: REGIONAL_MUSIC_ARTISTS[canonicalArtist].aliases[1],
        profile_url: profileUrl,
        followers,
        observed_at: observedAt,
      });
      collected += 1;
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = collected === Object.keys(JOOX_ARTISTS).length ? 'ok' : collected ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'joox',
    status,
    last_attempt_at: observedAt,
    last_success_at: collected ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists: collected, failed_artists: failures.length },
    updated_at: observedAt,
  });
  return { service: 'joox', status, artists: collected, failures };
}
