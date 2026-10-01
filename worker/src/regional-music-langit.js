import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { saveRegionalCollectorState, saveRegionalTrack } from './regional-music-store.js';

const LANGIT_ROOT = 'https://langitmusik.co.id';
const TRACK_LIMIT = 30;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function langitSearchUrl(query, template = `${LANGIT_ROOT}/search?q={query}`) {
  return String(template).replaceAll('{query}', encodeURIComponent(query));
}

export function parseLangitSearch(html, aliases) {
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();
  const source = String(html || '');

  for (const match of source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(match[1]);
      const values = Array.isArray(raw) ? raw : Array.isArray(raw?.['@graph']) ? raw['@graph'] : [raw];
      for (const value of values) {
        if (value?.['@type'] !== 'MusicRecording') continue;
        const byArtist = Array.isArray(value.byArtist) ? value.byArtist : [value.byArtist];
        const artists = byArtist.filter(Boolean).map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean);
        if (!artists.some((artist) => wanted.has(normalize(artist)))) continue;
        const id = value.identifier || String(value.url || '').match(/songId=(\d+)/)?.[1] || value.url;
        if (!id || seen.has(String(id))) continue;
        seen.add(String(id));
        output.push({
          track_id: String(id),
          title: value.name || null,
          album_name: value.inAlbum?.name || null,
          track_url: value.url || null,
        });
      }
    } catch {
      // Ignore malformed schema blocks.
    }
  }

  for (const match of source.matchAll(/href=["']([^"']*shareSong\.do\?songId=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = match[2];
    if (!id || seen.has(id)) continue;
    const contextStart = Math.max(0, match.index - 600);
    const context = source.slice(contextStart, match.index + match[0].length + 600);
    if (![...wanted].some((alias) => normalize(context).includes(alias))) continue;
    seen.add(id);
    const title = String(match[3] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    const href = match[1];
    output.push({
      track_id: id,
      title,
      album_name: null,
      track_url: href.startsWith('http') ? href : `${LANGIT_ROOT}${href.startsWith('/') ? '' : '/'}${href}`,
    });
    if (output.length >= TRACK_LIMIT) break;
  }

  return output.slice(0, TRACK_LIMIT);
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'id-ID,id;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectLangitMusik(env, observedAt = Date.now(), fetchImpl = fetch) {
  if (String(env?.LANGIT_MUSIK_AUTHORIZED_COLLECTION || '') !== '1') {
    await saveRegionalCollectorState(env, {
      service: 'langit_musik',
      status: 'pending',
      last_attempt_at: observedAt,
      last_error_class: 'authorization_required_by_terms',
      last_error_message: 'Collector code is installed but network collection is disabled. Set LANGIT_MUSIK_AUTHORIZED_COLLECTION=1 only when authorized to automate access.',
      entity_counts: { artists: 0, tracks: 0 },
      updated_at: observedAt,
    });
    return { service: 'langit_musik', status: 'pending', artists: 0, tracks: 0, failures: [] };
  }

  const failures = [];
  let artists = 0;
  let tracks = 0;
  const template = env?.LANGIT_MUSIK_SEARCH_URL_TEMPLATE || `${LANGIT_ROOT}/search?q={query}`;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const seen = new Set();
      let matched = 0;
      for (const alias of artist.aliases) {
        const html = await fetchHtml(fetchImpl, langitSearchUrl(alias, template));
        for (const entry of parseLangitSearch(html, artist.aliases)) {
          if (seen.has(entry.track_id)) continue;
          seen.add(entry.track_id);
          await saveRegionalTrack(env, {
            service: 'langit_musik',
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
      else failures.push({ canonical_artist: canonicalArtist, error: 'no exact Langit Musik catalog match found' });
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'langit_musik',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'langit_musik', status, artists, tracks, failures };
}
