import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { saveRegionalCollectorState, saveRegionalTrack } from './regional-music-store.js';

const PLERN_ROOT = 'https://plern.co';
const COMING_SOON_MARKERS = ['เปิดตัวเร็วๆ นี้', 'coming soon'];

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function plernSearchUrl(query) {
  return `${PLERN_ROOT}/search?q=${encodeURIComponent(query)}`;
}

export function plernCatalogUnavailable(html) {
  const text = String(html || '').toLocaleLowerCase('en-US');
  return COMING_SOON_MARKERS.some((marker) => text.includes(marker.toLocaleLowerCase('en-US')));
}

function parseJsonLdTracks(html, aliases) {
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(match[1]);
      const values = Array.isArray(raw) ? raw : Array.isArray(raw?.['@graph']) ? raw['@graph'] : [raw];
      for (const value of values) {
        if (value?.['@type'] !== 'MusicRecording') continue;
        const byArtist = Array.isArray(value.byArtist) ? value.byArtist : [value.byArtist];
        const artists = byArtist.filter(Boolean).map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean);
        if (!artists.some((artist) => wanted.has(normalize(artist)))) continue;
        const id = value.identifier || value.url || value['@id'];
        if (!id) continue;
        output.push({
          track_id: String(id),
          title: value.name || null,
          album_name: value.inAlbum?.name || null,
          track_url: value.url || null,
        });
      }
    } catch {
      // Ignore malformed structured-data blocks.
    }
  }
  return output;
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'th-TH,th;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectPlern(env, observedAt = Date.now(), fetchImpl = fetch) {
  let rootHtml;
  try {
    rootHtml = await fetchHtml(fetchImpl, PLERN_ROOT);
  } catch (error) {
    const message = String(error?.message || error);
    await saveRegionalCollectorState(env, {
      service: 'plern',
      status: 'error',
      last_attempt_at: observedAt,
      last_error_class: 'upstream_error',
      last_error_message: message.slice(0, 1000),
      entity_counts: { artists: 0, tracks: 0, failures: 1 },
      updated_at: observedAt,
    });
    return { service: 'plern', status: 'error', artists: 0, tracks: 0, failures: [{ error: message }] };
  }

  if (!rootHtml || plernCatalogUnavailable(rootHtml)) {
    await saveRegionalCollectorState(env, {
      service: 'plern',
      status: 'pending',
      last_attempt_at: observedAt,
      last_error_class: 'catalog_surface_unavailable',
      last_error_message: 'Plern public web catalog is currently unavailable/coming soon; collector will probe again on the next scheduled run.',
      entity_counts: { artists: 0, tracks: 0 },
      updated_at: observedAt,
    });
    return { service: 'plern', status: 'pending', artists: 0, tracks: 0, failures: [] };
  }

  const failures = [];
  let artists = 0;
  let tracks = 0;
  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const seen = new Set();
      let matched = 0;
      for (const alias of artist.aliases) {
        const html = await fetchHtml(fetchImpl, plernSearchUrl(alias));
        for (const entry of parseJsonLdTracks(html, artist.aliases)) {
          if (seen.has(entry.track_id)) continue;
          seen.add(entry.track_id);
          await saveRegionalTrack(env, {
            service: 'plern',
            service_track_id: entry.track_id,
            canonical_artist: canonicalArtist,
            title: entry.title,
            album_name: entry.album_name,
            track_url: entry.track_url,
            observed_at: observedAt,
          });
          tracks += 1;
          matched += 1;
        }
      }
      if (matched) artists += 1;
      else failures.push({ canonical_artist: canonicalArtist, error: 'no exact Plern catalog match found' });
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'plern',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'plern', status, artists, tracks, failures };
}
