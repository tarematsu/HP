const APPLE_MUSIC_WEB_ORIGIN = 'https://music.apple.com';
const APPLE_MUSIC_API_HOST = 'api.music.apple.com';
const APPLE_MUSIC_BOOTSTRAP_PATH = '/us/browse';
const APPLE_MUSIC_BOOTSTRAP_CANDIDATES = Object.freeze([
  'https://music.apple.com/',
  'https://music.apple.com/us/new',
]);

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u;
const SCRIPT_PATTERN = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/giu;

function requestUrl(input) {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return new URL(input.toString());
  return new URL(input.url);
}

function bundlePriority(value) {
  try {
    const pathname = new URL(value, APPLE_MUSIC_WEB_ORIGIN).pathname;
    if (/\/assets\/index[~.-]/u.test(pathname)) return 0;
    if (/\/assets\/index/u.test(pathname)) return 1;
    if (/\/assets\//u.test(pathname)) return 2;
  } catch {
    // Keep malformed URLs at the end and let the collector ignore them.
  }
  return 3;
}

export function prioritizeAppleMusicBundles(html) {
  const source = String(html || '');
  const seen = new Set();
  const scripts = [];
  let order = 0;

  for (const match of source.matchAll(SCRIPT_PATTERN)) {
    const src = match[1];
    if (!src || seen.has(src)) continue;
    seen.add(src);
    scripts.push({ src, priority: bundlePriority(src), order: order++ });
  }

  if (!scripts.length) return source;

  scripts.sort((a, b) => a.priority - b.priority || a.order - b.order);
  const prefix = scripts
    .slice(0, 16)
    .map(({ src }) => `<script src="${src.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></script>`)
    .join('');
  return `${prefix}${source}`;
}

function hasBootstrapMaterial(html) {
  const source = String(html || '');
  return JWT_PATTERN.test(source) || /<script[^>]+src=["'][^"']+\.js(?:\?[^"']*)?["']/iu.test(source);
}

function responseFrom(response, body) {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchBootstrap(baseFetch, originalInput, init) {
  const originalUrl = requestUrl(originalInput).toString();
  const candidates = [...new Set([...APPLE_MUSIC_BOOTSTRAP_CANDIDATES, originalUrl])];
  let lastResponse = null;

  for (const url of candidates) {
    let response;
    try {
      response = await baseFetch(url, init);
    } catch {
      continue;
    }
    lastResponse = response;
    if (!response?.ok) continue;

    const html = await response.text();
    const prioritized = prioritizeAppleMusicBundles(html);
    if (hasBootstrapMaterial(prioritized)) return responseFrom(response, prioritized);
  }

  if (lastResponse) return lastResponse;
  return baseFetch(originalInput, init);
}

function retryHeaders(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const override = new Headers(init?.headers || undefined);
  for (const [name, value] of override) headers.set(name, value);
  headers.set('origin', 'https://apple.com');
  headers.set('referer', 'https://music.apple.com/');
  return headers;
}

export function createAppleMusicFetch(baseFetch = fetch) {
  return async function appleMusicFetch(input, init = {}) {
    const url = requestUrl(input);
    if (url.origin === APPLE_MUSIC_WEB_ORIGIN && url.pathname === APPLE_MUSIC_BOOTSTRAP_PATH) {
      return fetchBootstrap(baseFetch, input, init);
    }

    const response = await baseFetch(input, init);
    if (url.hostname !== APPLE_MUSIC_API_HOST || ![401, 403].includes(Number(response?.status))) {
      return response;
    }

    return baseFetch(input, {
      ...init,
      headers: retryHeaders(input, init),
    });
  };
}

export const appleMusicFetch = createAppleMusicFetch();
