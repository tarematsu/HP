import { browserCandidateText, collectBrowserPage, throwIfBrowserSourceAborted } from './browser-source.js';
import { extractVideoUrls, normalizeMediaHost } from './extractor.js';
import { extractItemIds, resolveItemVideos } from './item-resolver.js';
import { mediaHostFor, sourceUrlFor } from './source-locator.js';

const REQUEST_TIMEOUT_MS = 60_000;
const RESOLVE_MAX_REQUESTS = 8;
const TWIVIDEO_API_MAX_REQUESTS = 24;
const BACKSLASH = String.fromCharCode(92);
const LOAD_MORE_TEXTS = Object.freeze(['もっと見る', '続きを読み込む', 'もっと読み込む']);
const TEXT_CONTENT_TYPE_RE = /(?:text\/|application\/(?:json|javascript|xhtml\+xml|xml))/i;
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/26.0 Mobile/15E148 Safari/604.1';

function normalizeSourceUrl(value) {
  const url = new URL(value || '');
  if (url.protocol !== 'https:') throw new Error('SOURCE_B_URL must use HTTPS');
  url.hash = '';
  return url.toString();
}

function normalizeSignalText(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replaceAll(`${BACKSLASH}u002f`, '/')
    .replaceAll(`${BACKSLASH}u002F`, '/')
    .replaceAll(`${BACKSLASH}u003a`, ':')
    .replaceAll(`${BACKSLASH}u003A`, ':')
    .replaceAll(`${BACKSLASH}/`, '/');
}

function twivideoApiUrl(sourceUrl, id) {
  const url = new URL('/api/video.php', sourceUrl);
  url.searchParams.set('id', id);
  return url.toString();
}

function extractTwivideoApiIds(text) {
  const ids = [];
  const seen = new Set();
  const normalized = normalizeSignalText(text);
  const patterns = [
    /(?:https?:\/\/twivideo\.net)?\/api\/video\.php\?[^\s"'<>]*\bid=([A-Za-z0-9_-]+)/gi,
    /[?&]id=([A-Za-z0-9_-]{4,})/gi,
    /data-(?:id|video-id)=["']([A-Za-z0-9_-]{4,})["']/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const id = String(match[1] || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= 80) return ids;
    }
  }
  return ids;
}

async function fetchText(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent': MOBILE_USER_AGENT
    },
    signal
  });
  const finalUrl = response.url || url;
  if (!response.ok) return { finalUrl, text: '' };
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !TEXT_CONTENT_TYPE_RE.test(contentType)) return { finalUrl, text: '' };
  return { finalUrl, text: await response.text() };
}

async function resolveTwivideoApiUrls(sourceUrl, ids, mediaHost, signal, fetchImpl) {
  const output = new Set();
  const uniqueIds = [...new Set(ids)].slice(0, TWIVIDEO_API_MAX_REQUESTS);
  for (const id of uniqueIds) {
    throwIfBrowserSourceAborted(signal);
    try {
      const apiUrl = twivideoApiUrl(sourceUrl, id);
      const { finalUrl, text } = await fetchText(fetchImpl, apiUrl, signal);
      for (const url of extractVideoUrls(normalizeSignalText(`${finalUrl}\n${text}`), Infinity, mediaHost)) {
        output.add(url);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return [...output];
}

export function addMediaCandidates(output, value, mediaHost = mediaHostFor()) {
  const urls = extractVideoUrls(normalizeSignalText(value), Infinity, normalizeMediaHost(mediaHost));
  for (const url of urls) output.add(url);
  return output;
}

export function validNextUrl(value, fallback = '') {
  try {
    return normalizeSourceUrl(value || fallback);
  } catch {
    return '';
  }
}

export async function collectSourceBApi(env = {}, signal, fetchImpl = globalThis.fetch) {
  return collectSourceBMediaUrls(env, signal, fetchImpl);
}

export async function collectSourceBMediaUrls(env = {}, signal, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  throwIfBrowserSourceAborted(signal);
  const startedAt = Date.now();
  const sourceUrl = normalizeSourceUrl(sourceUrlFor(env, 'B'));
  const host = normalizeMediaHost(mediaHostFor(env));
  const page = await collectBrowserPage(env, 'B', sourceUrl, signal, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    loadMore: true,
    loadMoreClicks: 3,
    loadMoreTexts: LOAD_MORE_TEXTS
  });
  throwIfBrowserSourceAborted(signal);

  const html = normalizeSignalText(browserCandidateText(page));
  const directUrls = extractVideoUrls(html, Infinity, host);
  const urls = new Set(directUrls);
  const apiIds = extractTwivideoApiIds(html);
  let resolvedUrlCount = 0;
  if (apiIds.length && urls.size < 120) {
    const resolvedApiUrls = await resolveTwivideoApiUrls(sourceUrl, apiIds, host, signal, fetchImpl);
    resolvedUrlCount += resolvedApiUrls.length;
    for (const url of resolvedApiUrls) urls.add(url);
  }
  const itemIds = extractItemIds([html], 80);
  if (itemIds.length && urls.size < 80) {
    const resolved = await resolveItemVideos(null, itemIds, 80 - urls.size, 4, signal, fetchImpl, { maxRequests: RESOLVE_MAX_REQUESTS }, env);
    resolvedUrlCount += resolved.length;
    for (const url of resolved) urls.add(url);
  }
  return {
    sourceUrl,
    finalUrl: page.finalUrl,
    urls: [...urls],
    pagesVisited: 1,
    sourceMode: 'twivideo-browser-load-more-api-and-bounded-resolver',
    loadMoreClicks: page.loadMoreClicks,
    apiUrlCount: apiIds.length,
    itemCount: itemIds.length,
    directUrlCount: directUrls.length,
    resolvedUrlCount,
    resourceUrlCount: page.resourceUrls.length,
    domSignalCount: page.domSignals.length,
    capture: page.capture,
    elapsedMs: Date.now() - startedAt
  };
}
