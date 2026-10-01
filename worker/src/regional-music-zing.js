import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { saveRegionalCollectorState, saveRegionalTrack } from './regional-music-store.js';

const ZING_DOMAIN = 'https://zingmp3.vn';
const ZING_SEARCH_PATH = '/api/v2/search/multi';
const ZING_TRACK_LIMIT = 20;
const SIGNED_KEYS = new Set(['ctime', 'id', 'type', 'page', 'count', 'version']);

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function hmac512Hex(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
}

export async function buildZingApiUrl(path, params, credentials, now = Date.now()) {
  const version = String(credentials.version || '1.19.1');
  const ctime = String(credentials.ctime ?? Math.floor(Number(now) / 1000));
  const all = { ...params, ctime, version };
  const canonical = Object.entries(all)
    .filter(([key, value]) => SIGNED_KEYS.has(key) && value != null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('');
  const digest = await sha256Hex(canonical);
  const sig = await hmac512Hex(credentials.secretKey, `${path}${digest}`);
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(all).map(([key, value]) => [key, String(value)])),
    apiKey: credentials.apiKey,
    sig,
  });
  return `${ZING_DOMAIN}${path}?${query}`;
}

export function parseZingSearchTracks(payload, aliases, limit = ZING_TRACK_LIMIT) {
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();

  function artistsOf(value) {
    const raw = value?.artists || value?.artist || value?.artistName || value?.artistsNames;
    if (Array.isArray(raw)) return raw.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean);
    if (raw && typeof raw === 'object') return [raw.name].filter(Boolean);
    return String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  function visit(value) {
    if (output.length >= limit || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;

    const link = String(value.link || '');
    const id = value.encodeId || value.id || value.code;
    const title = value.title || value.name;
    const artists = artistsOf(value);
    const songLike = link.includes('/bai-hat/') || (id && value.duration != null);
    if (songLike && id && title && artists.some((artist) => wanted.has(normalize(artist)))) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        output.push({
          track_id: key,
          title: String(title),
          album_name: value.album?.title || value.album?.name || value.albumTitle || null,
          track_url: link ? (link.startsWith('http') ? link : `${ZING_DOMAIN}${link}`) : `${ZING_DOMAIN}/bai-hat/${key}.html`,
        });
      }
    }
    for (const child of Object.values(value)) visit(child);
  }

  visit(payload?.data ?? payload);
  return output.slice(0, limit);
}

function credentialsFromEnv(env) {
  const apiKey = String(env?.ZING_MP3_API_KEY || '').trim();
  const secretKey = String(env?.ZING_MP3_SECRET_KEY || '').trim();
  if (!apiKey || !secretKey) return null;
  return {
    apiKey,
    secretKey,
    version: String(env?.ZING_MP3_API_VERSION || '1.19.1'),
  };
}

async function fetchJson(fetchImpl, url, cookie) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.7',
      referer: `${ZING_DOMAIN}/`,
      origin: ZING_DOMAIN,
      ...(cookie ? { cookie } : {}),
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.err != null && payload.err !== 0) throw new Error(`Zing API ${payload.err}: ${payload.msg || 'unknown error'}`);
  return payload;
}

async function visitorCookie(fetchImpl) {
  const response = await fetchImpl(`${ZING_DOMAIN}/`, {
    headers: { 'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0' },
    redirect: 'follow',
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/(?:^|[,;]\s*)(zmp3_rqid=[^;,]+)/i);
  return match?.[1] || null;
}

export async function collectZingMp3(env, observedAt = Date.now(), fetchImpl = fetch) {
  const credentials = credentialsFromEnv(env);
  if (!credentials) {
    await saveRegionalCollectorState(env, {
      service: 'zing_mp3',
      status: 'pending',
      last_attempt_at: observedAt,
      last_error_class: 'credentials_required',
      last_error_message: 'Set ZING_MP3_API_KEY and ZING_MP3_SECRET_KEY from an authorized/current Zing web client configuration.',
      entity_counts: { artists: 0, tracks: 0 },
      updated_at: observedAt,
    });
    return { service: 'zing_mp3', status: 'pending', artists: 0, tracks: 0, failures: [] };
  }

  const failures = [];
  let artists = 0;
  let tracks = 0;
  const cookie = await visitorCookie(fetchImpl).catch(() => null);

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      let found = [];
      for (const alias of artist.aliases) {
        const url = await buildZingApiUrl(ZING_SEARCH_PATH, { q: alias, allowCorrect: '1' }, credentials, observedAt);
        const payload = await fetchJson(fetchImpl, url, cookie);
        found = parseZingSearchTracks(payload, artist.aliases);
        if (found.length) break;
      }
      for (const entry of found) {
        await saveRegionalTrack(env, {
          service: 'zing_mp3',
          service_track_id: entry.track_id,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: entry.track_url,
          observed_at: observedAt,
        });
        tracks += 1;
      }
      if (found.length) artists += 1;
      else failures.push({ canonical_artist: canonicalArtist, error: 'no exact Zing MP3 catalog match found' });
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'zing_mp3',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'zing_mp3', status, artists, tracks, failures };
}
