import {
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
  extractNextToken,
} from './amazon-music-web-client.js';

export {
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
  extractNextToken,
};

const AMAZON_HOST = 'music.amazon.co.jp';
const AMAZON_ORIGIN = `https://${AMAZON_HOST}`;
const CONFIG_URL = `${AMAZON_ORIGIN}/config.json?skipToken=false&clientApplication=skyfire`;
const WEB_SKILL_BASE = 'https://fe.web.skill.music.a2z.com/api';
const CATALOG_SKILL_BASE = 'https://fe.mesk.skill.music.a2z.com/api';
const CONFIG_CACHE_MS = 30 * 60_000;
const MAX_ARTIST_PAGES = 25;
const MAX_TRACKS = 500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });

let cachedConfig = null;
let configExpiresAt = 0;
let primePromise = null;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function walk(value, visit, depth = 0) {
  if (value === null || value === undefined || depth > 20) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  if (!object(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit, depth + 1);
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  const value = await response.json();
  if (!object(value)) throw new Error(`${label} returned a non-object payload`);
  return value;
}

async function config(fetchImpl) {
  const now = Date.now();
  if (cachedConfig && now < configExpiresAt) return cachedConfig;
  const response = await fetchImpl(CONFIG_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
      'user-agent': USER_AGENT,
      referer: `${AMAZON_ORIGIN}/`,
    },
  });
  cachedConfig = await responseJson(response, 'Amazon Music config');
  configExpiresAt = now + CONFIG_CACHE_MS;
  primePromise = null;
  return cachedConfig;
}

function amazonHeaders(configuration, pageUrl) {
  const csrf = object(configuration?.csrf) || {};
  return {
    'x-amzn-authentication': JSON.stringify({
      interface: 'ClientAuthenticationInterface.v1_0.ClientTokenElement',
      accessToken: configuration?.accessToken || '',
    }),
    'x-amzn-device-model': 'WEBPLAYER',
    'x-amzn-device-width': '1920',
    'x-amzn-device-family': 'WebPlayer',
    'x-amzn-device-id': configuration?.deviceId || '',
    'x-amzn-user-agent': USER_AGENT,
    'x-amzn-session-id': configuration?.sessionId || '',
    'x-amzn-device-height': '1080',
    'x-amzn-request-id': crypto.randomUUID(),
    'x-amzn-device-language': 'ja_JP',
    'x-amzn-currency-of-preference': 'JPY',
    'x-amzn-os-version': '1.0',
    'x-amzn-application-version': configuration?.version || '',
    'x-amzn-device-time-zone': 'UTC',
    'x-amzn-timestamp': String(Date.now()),
    'x-amzn-csrf': JSON.stringify({
      interface: 'CSRFInterface.v1_0.CSRFHeaderElement',
      token: csrf.token || '',
      timestamp: csrf.ts == null ? '' : String(csrf.ts),
      rndNonce: csrf.rnd == null ? '' : String(csrf.rnd),
    }),
    'x-amzn-music-domain': AMAZON_HOST,
    'x-amzn-referer': '',
    'x-amzn-affiliate-tags': '',
    'x-amzn-ref-marker': '',
    'x-amzn-page-url': pageUrl,
    'x-amzn-weblab-id-overrides': '',
    'x-amzn-video-player-token': '',
    'x-amzn-feature-flags': 'hd-supported,uhd-supported',
    'x-amzn-has-profile-id': '',
    'x-amzn-age-band': '',
  };
}

function outerHeaders() {
  return {
    accept: '*/*',
    'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
    'content-type': 'text/plain;charset=UTF-8',
    origin: AMAZON_ORIGIN,
    referer: `${AMAZON_ORIGIN}/`,
    'user-agent': USER_AGENT,
  };
}

async function postSkill(fetchImpl, base, path, request, pageUrl) {
  const configuration = await config(fetchImpl);
  const response = await fetchImpl(`${base}${path}`, {
    method: 'POST',
    headers: outerHeaders(),
    body: JSON.stringify({
      ...request,
      headers: JSON.stringify(amazonHeaders(configuration, pageUrl)),
    }),
  });
  return responseJson(response, `Amazon Music ${path}`);
}

async function primeWebPlayer(fetchImpl, artistId) {
  if (primePromise) return primePromise;
  primePromise = (async () => {
    const pageUrl = `${AMAZON_ORIGIN}/artists/${encodeURIComponent(artistId)}`;
    const deeplink = JSON.stringify({
      interface: 'DeeplinkInterface.v1_0.DeeplinkClientInformation',
      deeplink: `/artists/${artistId}`,
    });
    return postSkill(fetchImpl, WEB_SKILL_BASE, '/showHome', { deeplink }, pageUrl);
  })().catch((error) => {
    primePromise = null;
    throw error;
  });
  return primePromise;
}

function nextCatalogTracksRequest(document) {
  let found = null;
  walk(document, (node) => {
    if (found) return;
    for (const value of Object.values(node)) {
      if (typeof value !== 'string' || !value.includes('/api/showCatalogTracks?') || !value.includes('next=')) continue;
      try {
        const url = new URL(value);
        const id = text(url.searchParams.get('id'));
        const next = text(url.searchParams.get('next'));
        const userHash = text(url.searchParams.get('userHash')) || USER_HASH;
        if (id && next) {
          found = { id, next, userHash };
          return;
        }
      } catch {
        // Ignore malformed observer/action URLs.
      }
    }
  });
  return found;
}

function isErrorOnlyPayload(document) {
  let hasDetail = false;
  let hasMessageError = false;
  walk(document, (node) => {
    const iface = text(node?.interface) || '';
    if (iface.includes('DetailTemplateInterface') || iface.includes('VerticalListTemplateInterface')) hasDetail = true;
    const message = text(node?.message);
    if (message && /アクションを完了できません|unable to complete|service error/i.test(message)) hasMessageError = true;
  });
  return hasMessageError && !hasDetail;
}

async function catalogPost(fetchImpl, path, request, pageUrl) {
  const document = await postSkill(fetchImpl, CATALOG_SKILL_BASE, path, request, pageUrl);
  if (isErrorOnlyPayload(document)) throw new Error(`Amazon Music ${path} returned an error template`);
  return document;
}

export function createAmazonMusicWebClient(fetchImpl = fetch) {
  return {
    async fetchArtist(artistId) {
      await primeWebPlayer(fetchImpl, artistId);
      const pageUrl = `${AMAZON_ORIGIN}/artists/${encodeURIComponent(artistId)}`;
      return catalogPost(fetchImpl, '/explore/v1/showCatalogArtist', {
        id: artistId,
        userHash: USER_HASH,
      }, pageUrl);
    },

    async fetchArtistTracks(artistId) {
      await primeWebPlayer(fetchImpl, artistId);
      const pageUrl = `${AMAZON_ORIGIN}/artists/${encodeURIComponent(artistId)}`;
      const all = [];
      const seen = new Set();
      let request = {
        id: `uri://artist/${artistId}/popular-songs`,
        userHash: USER_HASH,
      };
      for (let page = 0; page < MAX_ARTIST_PAGES && all.length < MAX_TRACKS; page += 1) {
        const document = await catalogPost(fetchImpl, '/showCatalogTracks', request, pageUrl);
        for (const track of extractAmazonMusicTracks(document)) {
          if (!track.amazon_music_id || seen.has(track.amazon_music_id)) continue;
          seen.add(track.amazon_music_id);
          all.push(track);
          if (all.length >= MAX_TRACKS) break;
        }
        const next = nextCatalogTracksRequest(document);
        if (!next || next.next === request.next) break;
        request = next;
      }
      return all.slice(0, MAX_TRACKS);
    },

    async fetchPlaylist(playlistId) {
      await primeWebPlayer(fetchImpl, 'B08P3RHP1P');
      const pageUrl = `${AMAZON_ORIGIN}/playlists/${encodeURIComponent(playlistId)}`;
      return catalogPost(fetchImpl, '/showCatalogPlaylist', {
        id: playlistId,
        userHash: USER_HASH,
      }, pageUrl);
    },

    async fetchTrack(trackId) {
      await primeWebPlayer(fetchImpl, 'B08P3RHP1P');
      const pageUrl = `${AMAZON_ORIGIN}/tracks/${encodeURIComponent(trackId)}`;
      return catalogPost(fetchImpl, '/cosmicTrack/displayCatalogTrack', {
        id: trackId,
        userHash: USER_HASH,
      }, pageUrl);
    },

    async fetchArtistPageHtml(artistId) {
      const response = await fetchImpl(`${AMAZON_ORIGIN}/artists/${encodeURIComponent(artistId)}`, {
        headers: {
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
          'user-agent': USER_AGENT,
        },
      });
      if (!response.ok) return '';
      return response.text();
    },

    async fetchPopularPageHtml() {
      const response = await fetchImpl(`${AMAZON_ORIGIN}/popular`, {
        headers: {
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
          'user-agent': USER_AGENT,
        },
      });
      if (!response.ok) return '';
      return response.text();
    },
  };
}

export function resetAmazonMusicWebClientCache() {
  cachedConfig = null;
  configExpiresAt = 0;
  primePromise = null;
}
