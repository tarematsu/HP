import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { saveRegionalCollectorState, saveRegionalTrack } from './regional-music-store.js';

const BOOMPLAY_SEARCH_LIMIT = 8;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function boomplaySearchUrl(query) {
  return `https://www.boomplay.com/search/default/${encodeURIComponent(query)}`;
}

export function boomplaySongUrl(songId) {
  return `https://www.boomplay.com/songs/${encodeURIComponent(songId)}`;
}

export function extractBoomplaySongIds(html, limit = BOOMPLAY_SEARCH_LIMIT) {
  const ids = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/(?:data-id=["']|\/songs\/)(\d+)/gi)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function jsonLdObjects(html) {
  const output = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) output.push(...parsed);
      else if (parsed?.['@graph'] && Array.isArray(parsed['@graph'])) output.push(...parsed['@graph']);
      else if (parsed && typeof parsed === 'object') output.push(parsed);
    } catch {
      // Ignore malformed schema blocks; another JSON-LD block may still be valid.
    }
  }
  return output;
}

export function parseBoomplayTrackSchema(html) {
  const value = jsonLdObjects(html).find((item) => item?.['@type'] === 'MusicRecording');
  if (!value) return null;
  const artists = (Array.isArray(value.byArtist) ? value.byArtist : [value.byArtist])
    .filter(Boolean)
    .map((artist) => typeof artist === 'string' ? artist : artist?.name)
    .filter(Boolean);
  return {
    title: value.name || null,
    artists,
    album_name: value.inAlbum?.name || null,
  };
}

function belongsToArtist(schema, aliases) {
  const wanted = new Set(aliases.map(normalize));
  return (schema?.artists || []).some((name) => wanted.has(normalize(name)));
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectBoomplay(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let tracks = 0;
  let matchedArtists = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      let matchedForArtist = 0;
      const candidateIds = new Set();
      for (const alias of artist.aliases) {
        const html = await fetchHtml(fetchImpl, boomplaySearchUrl(alias));
        for (const id of extractBoomplaySongIds(html)) candidateIds.add(id);
        if (candidateIds.size >= BOOMPLAY_SEARCH_LIMIT) break;
      }

      for (const songId of [...candidateIds].slice(0, BOOMPLAY_SEARCH_LIMIT)) {
        try {
          const url = boomplaySongUrl(songId);
          const schema = parseBoomplayTrackSchema(await fetchHtml(fetchImpl, url));
          if (!schema || !belongsToArtist(schema, artist.aliases)) continue;
          await saveRegionalTrack(env, {
            service: 'boomplay',
            service_track_id: songId,
            canonical_artist: canonicalArtist,
            title: schema.title,
            album_name: schema.album_name,
            track_url: url,
            observed_at: observedAt,
          });
          tracks += 1;
          matchedForArtist += 1;
        } catch (error) {
          failures.push({ canonical_artist: canonicalArtist, track_id: songId, error: String(error?.message || error) });
        }
      }

      if (matchedForArtist) matchedArtists += 1;
      else failures.push({ canonical_artist: canonicalArtist, error: 'no exact Boomplay catalog match found' });
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'boomplay',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists: matchedArtists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'boomplay', status, artists: matchedArtists, tracks, failures };
}
