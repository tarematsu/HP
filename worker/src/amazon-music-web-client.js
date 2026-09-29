const AMAZON_HOST = 'music.amazon.co.jp';
const AMAZON_ORIGIN = `https://${AMAZON_HOST}`;
const CONFIG_URL = `${AMAZON_ORIGIN}/config.json?skipToken=false&clientApplication=skyfire`;
const WEB_SKILL_BASE = 'https://fe.web.skill.music.a2z.com/api';
const CATALOG_SKILL_BASE = 'https://fe.mesk.skill.music.a2z.com/api';
const CONFIG_CACHE_MS = 30 * 60_000;
const MAX_ARTIST_PAGES = 25;
const MAX_TRACKS = 500;
const MAX_OVERALL_CHART_PAGES = 550;
const OVERALL_CHART_PAGE_URL = `${AMAZON_ORIGIN}/popular/songs/browsePanel/popularTracks`;
const OVERALL_CHART_INITIAL_URL = `${CATALOG_SKILL_BASE}/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&userHash=%7B%22level%22%3A%22LIBRARY_MEMBER%22%7D`;
const OVERALL_CHART_RETRY_ATTEMPTS = 6;
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let cachedConfig = null;
let configExpiresAt = 0;
let primePromise = null;

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function deepValues(value, visit, depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) deepValues(child, visit, depth + 1);
    return;
  }
  const entry = object(value);
  if (!entry) return;
  visit(entry);
  for (const child of Object.values(entry)) deepValues(child, visit, depth + 1);
}

function stringValue(value) {
  if (typeof value === 'string') return text(value);
  const entry = object(value);
  return text(entry?.text ?? entry?.value ?? entry?.label ?? entry?.title);
}

function idFromUrl(value, kind = 'tracks') {
  const input = text(value);
  if (!input) return null;
  const match = input.match(new RegExp(`/${kind}/([A-Za-z0-9]+)`, 'i'));
  return match?.[1] || null;
}

function amazonTrackId(node) {
  const storageKey = text(node?.iconButton?.observer?.storageKey ?? node?.observer?.storageKey);
  if (storageKey) {
    const parts = storageKey.split(':').filter(Boolean);
    if (parts.length >= 2 && /^[A-Za-z0-9]+$/.test(parts.at(-1))) return parts.at(-1);
  }
  for (const value of [
    node?.deeplink,
    node?.url,
    node?.href,
    node?.primaryTextLink?.deeplink,
    node?.secondaryTextLink?.deeplink,
  ]) {
    const id = idFromUrl(value);
    if (id) return id;
  }
  const type = text(node?.type ?? node?.contentType ?? node?.entityType)?.toLowerCase() || '';
  if (type.includes('track') || type.includes('song')) {
    for (const value of [node?.id, node?.asin, node?.trackId, node?.track_id]) {
      const id = text(value);
      if (id && /^[A-Za-z0-9]+$/.test(id)) return id;
    }
  }
  return null;
}

function normalizedIsrc(value) {
  const isrc = text(value)?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;
  return isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : null;
}

function isrcFromNode(node) {
  for (const key of ['isrc', 'ISRC', 'isrcCode', 'isrc_code']) {
    const direct = normalizedIsrc(node?.[key]);
    if (direct) return direct;
  }
  return null;
}

function artistFromNode(node) {
  const direct = stringValue(node?.artist ?? node?.artistName ?? node?.artist_name);
  if (direct) return direct;
  const secondary = stringValue(node?.secondaryText ?? node?.secondaryText1 ?? node?.subtitle);
  if (secondary) return secondary;
  const artists = Array.isArray(node?.artists) ? node.artists : [];
  const names = artists.map((artist) => stringValue(artist?.name ?? artist)).filter(Boolean);
  return names.length ? names.join(', ') : null;
}

function titleFromNode(node) {
  const direct = stringValue(node?.title ?? node?.name ?? node?.primaryText);
  return direct?.replace(/^\d+\.\s*/u, '') || null;
}

function albumFromNode(node) {
  return stringValue(node?.album?.name ?? node?.albumName ?? node?.album_name);
}

function imageFromNode(node) {
  const image = node?.image ?? node?.cover ?? node?.artwork;
  if (typeof image === 'string') return text(image);
  return text(image?.url ?? image?.src ?? image?.uri);
}

function extractFromJson(root) {
  const tracks = [];
  const seen = new Set();
  deepValues(root, (node) => {
    const amazonMusicId = amazonTrackId(node);
    if (!amazonMusicId || seen.has(amazonMusicId)) return;
    const title = titleFromNode(node);
    const artist = artistFromNode(node);
    const isrc = isrcFromNode(node);
    if (!title && !artist && !isrc) return;
    seen.add(amazonMusicId);
    tracks.push({
      amazon_music_id: amazonMusicId,
      title,
      artist,
      album: albumFromNode(node),
      image: imageFromNode(node),
      isrc,
    });
  });
  return tracks;
}

function embeddedJsonDocuments(html) {
  const documents = [];
  for (const match of String(html || '').matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      documents.push(JSON.parse(match[1]));
    } catch {
      // Ignore non-JSON application/json blocks.
    }
  }
  return documents;
}

function htmlTrackFallback(html) {
  const tracks = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/(?:href|url)=["'][^"']*\/tracks\/([A-Za-z0-9]+)[^"']*["']/gi)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      tracks.push({ amazon_music_id: id, title: null, artist: null, album: null, image: null, isrc: null });
    }
  }
  return tracks;
}

export function extractAmazonMusicTracks(value) {
  const tracks = typeof value === 'string'
    ? embeddedJsonDocuments(value).flatMap(extractFromJson)
    : extractFromJson(value);
  const seen = new Set();
  const unique = tracks.filter((track) => {
    if (!track.amazon_music_id || seen.has(track.amazon_music_id)) return false;
    seen.add(track.amazon_music_id);
    return true;
  });
  if (unique.length || typeof value !== 'string') return unique.slice(0, MAX_TRACKS);
  return htmlTrackFallback(value).slice(0, MAX_TRACKS);
}

function followerLabelToCount(label) {
  const input = text(label);
  if (!input || !/(?:フォロワ|follower)/i.test(input)) return null;
  const match = input.replaceAll(',', '').match(/(\d+(?:\.\d+)?)\s*(千|万|[kKmM])?/u);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = match[2] || '';
  const multiplier = unit === '千' || unit.toLowerCase() === 'k'
    ? 1_000
    : unit === '万'
      ? 10_000
      : unit.toLowerCase() === 'm'
        ? 1_000_000
        : 1;
  return Math.round(base * multiplier);
}

export function extractFollowerCount(value) {
  let exact = null;
  let label = null;
  const inspect = (node) => {
    for (const key of ['followerCount', 'follower_count', 'followersCount', 'followers_count']) {
      const count = Number(node?.[key]);
      if (Number.isSafeInteger(count) && count >= 0) exact ??= count;
    }
    for (const [key, raw] of Object.entries(node)) {
      if (!/(?:follower|フォロワ)/i.test(key) && typeof raw !== 'string') continue;
      const candidate = stringValue(raw);
      if (candidate && /(?:follower|フォロワ)/i.test(candidate)) label ??= candidate;
    }
  };
  if (typeof value === 'string') {
    const html = value;
    const match = html.match(/([^<>]{0,40}(?:フォロワ|followers?)[^<>]{0,40})/iu);
    if (match) label = match[1].replace(/&nbsp;/g, ' ').trim();
    for (const document of embeddedJsonDocuments(html)) deepValues(document, inspect);
  } else {
    deepValues(value, inspect);
  }
  if (exact !== null) return { count: exact, exact: true, label: label || String(exact) };
  const approximate = followerLabelToCount(label);
  return approximate === null ? null : { count: approximate, exact: false, label };
}

export function extractNextToken(value) {
  let token = null;
  deepValues(value, (node) => {
    if (token) return;
    for (const key of ['nextPageToken', 'next_page_token', 'nextToken', 'next_token', 'next']) {
      const candidate = text(node?.[key]);
      if (candidate && candidate.length >= 8 && candidate.length <= 4096) {
        token = candidate;
        return;
      }
    }
  });
  return token;
}

export function extractIsrc(value) {
  let isrc = null;
  deepValues(value, (node) => {
    if (!isrc) isrc = isrcFromNode(node);
  });
  return isrc;
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
  deepValues(document, (node) => {
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
        // Ignore malformed action URLs.
      }
    }
  });
  return found;
}

function nextChartsWidgetUrl(document) {
  let found = null;
  deepValues(document, (node) => {
    if (found) return;
    for (const value of Object.values(node)) {
      if (typeof value !== 'string'
        || !value.includes('/api/showChartsWidget?')
        || !value.includes('widgetId=top-songs')
        || !value.includes('next=')) continue;
      try {
        found = new URL(value, CATALOG_SKILL_BASE).toString();
        return;
      } catch {
        // Ignore malformed action URLs.
      }
    }
  });
  return found;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isErrorOnlyPayload(document) {
  let hasContent = false;
  let hasError = false;
  deepValues(document, (node) => {
    const iface = text(node?.interface) || '';
    if (iface.includes('DetailTemplateInterface')
      || iface.includes('VerticalListTemplateInterface')
      || iface.includes('TrackListTemplateInterface')) hasContent = true;
    const message = text(node?.message);
    if (message && /アクションを完了できません|unable to complete|service error/i.test(message)) hasError = true;
  });
  return hasError && !hasContent;
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

    async fetchOverallTrackRanks(targetIds = null) {
      await primeWebPlayer(fetchImpl, 'B08P3RHP1P');
      const targets = targetIds == null
        ? null
        : new Set([...targetIds].map((value) => text(value)).filter(Boolean));
      const hits = [];
      const seenUrls = new Set();
      const seenTrackIds = new Set();
      let url = OVERALL_CHART_INITIAL_URL;
      let scannedTracks = 0;
      let exhausted = false;

      for (let page = 0; page < MAX_OVERALL_CHART_PAGES; page += 1) {
        if (!url || seenUrls.has(url)) {
          exhausted = true;
          break;
        }
        seenUrls.add(url);

        let document = null;
        for (let attempt = 0; attempt < OVERALL_CHART_RETRY_ATTEMPTS; attempt += 1) {
          const configuration = await config(fetchImpl);
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: outerHeaders(),
            body: JSON.stringify({
              headers: JSON.stringify(amazonHeaders(configuration, OVERALL_CHART_PAGE_URL)),
            }),
          });
          if (response.status === 429) {
            await sleep(Math.min(15_000, 1_000 * (2 ** attempt)));
            continue;
          }
          document = await responseJson(response, 'Amazon Music overall chart');
          if (isErrorOnlyPayload(document)) {
            throw new Error('Amazon Music overall chart returned an error template');
          }
          break;
        }
        if (!document) throw new Error('Amazon Music overall chart rate-limit retries exhausted');

        const pageTracks = extractAmazonMusicTracks(document);
        const fresh = pageTracks.filter((track) => {
          const id = text(track?.amazon_music_id);
          return id && !seenTrackIds.has(id);
        });
        if (!fresh.length) {
          exhausted = true;
          break;
        }
        for (const track of fresh) {
          seenTrackIds.add(track.amazon_music_id);
          scannedTracks += 1;
          if (!targets || targets.has(track.amazon_music_id)) {
            hits.push({ ...track, rank: scannedTracks });
          }
        }
        if (targets && hits.length >= targets.size) {
          exhausted = true;
          break;
        }
        const next = nextChartsWidgetUrl(document);
        if (!next || seenUrls.has(next)) {
          exhausted = true;
          break;
        }
        url = next;
      }
      return { hits, scanned_tracks: scannedTracks, exhausted };
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

export function resetAmazonMusicConfigCache() {
  cachedConfig = null;
  configExpiresAt = 0;
  primePromise = null;
}
