import { visibleHtmlText } from './regional-music-html.js';
import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const FUNGJAI_ROOT = 'https://www.fungjai.com';
const TRACK_LIMIT = 30;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function fungjaiArtistSlug(alias) {
  return String(alias || '')
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function fungjaiArtistUrl(slug) {
  return `${FUNGJAI_ROOT}/artists/${encodeURIComponent(slug)}`;
}

export function parseFungjaiTrackLinks(html, artistSlug, aliases) {
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();
  const source = String(html || '');

  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"']*\/artists\/([^/"']+)\/musics\/([^?"'#]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const slug = decodeURIComponent(match[2] || '');
    if (normalize(slug) !== normalize(artistSlug) && !wanted.has(normalize(slug))) continue;
    const trackSlug = decodeURIComponent(match[3] || '');
    const key = `${slug}/${trackSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = String(match[4] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || trackSlug;
    output.push({
      track_id: key,
      title,
      track_url: href.startsWith('http') ? href : `${FUNGJAI_ROOT}${href.startsWith('/') ? '' : '/'}${href}`,
    });
    if (output.length >= TRACK_LIMIT) break;
  }
  return output;
}

export function pageRepresentsArtist(html, aliases) {
  const normalized = normalize(visibleHtmlText(html));
  return aliases.some((alias) => normalized.includes(normalize(alias)));
}

async function fetchPage(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'th-TH,th;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
    redirect: 'follow',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (/<title>\s*(?:One moment, please|Just a moment)/i.test(html)) {
    throw new Error('upstream access verification required');
  }
  return { html, url: response.url || url };
}

export async function collectFungjai(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let upstreamFailures = 0;
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      let profile = null;
      let profileSlug = null;
      for (const alias of artist.aliases) {
        const slug = fungjaiArtistSlug(alias);
        if (!slug) continue;
        const candidate = await fetchPage(fetchImpl, fungjaiArtistUrl(slug));
        if (candidate && pageRepresentsArtist(candidate.html, artist.aliases)) {
          profile = candidate;
          profileSlug = slug;
          break;
        }
      }

      if (!profile || !profileSlug) {
        failures.push({ canonical_artist: canonicalArtist, error: 'no current/legacy Fungjai artist catalog page found' });
        continue;
      }

      await saveRegionalArtist(env, {
        service: 'fungjai',
        canonical_artist: canonicalArtist,
        service_artist_id: profileSlug,
        display_name: artist.aliases[1],
        profile_url: profile.url,
        observed_at: observedAt,
      });
      artists += 1;

      for (const entry of parseFungjaiTrackLinks(profile.html, profileSlug, artist.aliases)) {
        await saveRegionalTrack(env, {
          service: 'fungjai',
          service_track_id: entry.track_id,
          service_artist_id: profileSlug,
          canonical_artist: canonicalArtist,
          title: entry.title,
          track_url: entry.track_url,
          observed_at: observedAt,
        });
        tracks += 1;
      }
    } catch (error) {
      upstreamFailures += 1;
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = artists
    ? (failures.length ? 'degraded' : 'ok')
    : upstreamFailures ? 'error' : 'pending';
  await saveRegionalCollectorState(env, {
    service: 'fungjai',
    status,
    last_attempt_at: observedAt,
    last_success_at: artists ? observedAt : null,
    last_error_class: upstreamFailures ? 'upstream_error' : failures.length ? 'catalog_not_available' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length, upstream_failures: upstreamFailures },
    updated_at: observedAt,
  });
  return { service: 'fungjai', status, artists, tracks, failures };
}
