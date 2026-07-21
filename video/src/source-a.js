import { browserCandidateText, collectBrowserPage, throwIfBrowserSourceAborted } from './browser-source.js';
import { extractVideoUrls, normalizeMediaHost } from './extractor.js';
import { mediaHostFor, sourceUrlFor } from './source-locator.js';

const REQUEST_TIMEOUT_MS = 60_000;
const LINK_MAX_REQUESTS = 32;
const BACKSLASH = String.fromCharCode(92);
const LOAD_MORE_TEXTS = Object.freeze(['もっと見る', '続きを読み込む', 'もっと読み込む']);
const STATIC_EXTENSION_RE = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)(?:\?|$)/i;
const TEXT_CONTENT_TYPE_RE = /(?:text\/|application\/(?:json|javascript|xhtml\+xml|xml))/i;
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/26.0 Mobile/15E148 Safari/604.1';

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function decodeHtmlUrlEscapes(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/&#x3a;|&#58;/gi, ':')
    .replaceAll(`${BACKSLASH}u002f`, '/')
    .replaceAll(`${BACKSLASH}u002F`, '/')
    .replaceAll(`${BACKSLASH}u003a`, ':')
    .replaceAll(`${BACKSLASH}u003A`, ':')
    .replaceAll(`${BACKSLASH}/`, '/');
}

export function normalizeSourceAUrl(value) {
  let url;
  try {
    url = new URL(value || '');
  } catch {
    throw new Error('SOURCE_A_URL must be a valid URL');
  }

  if (url.protocol !== 'https:') throw new Error('SOURCE_A_URL must use HTTPS');
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

function isLikelyNavigationLink(url, sourceUrl) {
  const source = new URL(sourceUrl);
  if (url.protocol !== source.protocol || url.hostname !== source.hostname) return true;
  if (STATIC_EXTENSION_RE.test(url.pathname)) return true;
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const normalizedSourcePath = source.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === normalizedSourcePath && url.search === source.search) return true;
  return new Set([
    '/', '/ranking', '/trend', '/new', '/archive', '/contact', '/terms', '/privacy', '/how-to-use', '/reels'
  ]).has(normalizedPath);
}

function addCandidateLink(output, value, sourceUrl) {
  if (!value || output.size >= LINK_MAX_REQUESTS) return;
  let candidate = decodeHtmlUrlEscapes(value).trim();
  if (!candidate || candidate.startsWith('#') || /^javascript:/i.test(candidate)) return;
  try {
    const url = new URL(candidate, sourceUrl);
    url.hash = '';
    if (isLikelyNavigationLink(url, sourceUrl)) return;
    output.add(url.toString());
  } catch {}
}

function extractTwixiveCandidateLinks(text, sourceUrl) {
  const output = new Set();
  const normalized = decodeHtmlUrlEscapes(text);
  const absolutePattern = /https?:\/\/twixive\.net\/[^\s"'<>\\)]+/gi;
  for (const match of normalized.matchAll(absolutePattern)) addCandidateLink(output, match[0], sourceUrl);
  const relativePattern = /(?:href|src|data-url|data-href|data-video-url)=["'](\/[^"'<>]+)["']/gi;
  for (const match of normalized.matchAll(relativePattern)) addCandidateLink(output, match[1], sourceUrl);
  return [...output].slice(0, LINK_MAX_REQUESTS);
}

async function fetchLinkedText(fetchImpl, url, signal) {
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

async function resolveTwixiveLinkedVideos(fetchImpl, links, mediaHost, signal) {
  const urls = new Set();
  for (const link of links.slice(0, LINK_MAX_REQUESTS)) {
    throwIfBrowserSourceAborted(signal);
    try {
      const { finalUrl, text } = await fetchLinkedText(fetchImpl, link, signal);
      const combined = decodeHtmlUrlEscapes(`${finalUrl}\n${text}`);
      for (const url of extractVideoUrls(combined, Infinity, mediaHost)) urls.add(url);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return [...urls];
}

export function extractSourceAMediaUrls(html, limit = Infinity, mediaHost = mediaHostFor()) {
  const host = normalizeMediaHost(mediaHost);
  return extractVideoUrls(decodeHtmlUrlEscapes(html), limit, host);
}

export async function collectSourceAMediaUrls(env = {}, signal, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  throwIfBrowserSourceAborted(signal);

  const startedAt = Date.now();
  const sourceUrl = normalizeSourceAUrl(sourceUrlFor(env, 'A'));
  const host = normalizeMediaHost(mediaHostFor(env));
  const page = await collectBrowserPage(env, 'A', sourceUrl, signal, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    loadMore: true,
    loadMoreClicks: 3,
    loadMoreTexts: LOAD_MORE_TEXTS
  });
  throwIfBrowserSourceAborted(signal);

  const html = browserCandidateText(page);
  const directUrls = extractSourceAMediaUrls(html, Infinity, host);
  const urls = new Set(directUrls);
  const linkedUrls = extractTwixiveCandidateLinks(html, sourceUrl);
  let resolvedUrlCount = 0;
  if (linkedUrls.length && urls.size < 120) {
    const resolved = await resolveTwixiveLinkedVideos(fetchImpl, linkedUrls, host, signal);
    resolvedUrlCount = resolved.length;
    for (const url of resolved) urls.add(url);
  }

  return {
    sourceUrl,
    finalUrl: page.finalUrl,
    urls: [...urls],
    sourceMode: 'twixive-browser-load-more-linked-pages',
    loadMoreClicks: page.loadMoreClicks,
    linkedUrlCount: linkedUrls.length,
    directUrlCount: directUrls.length,
    resolvedUrlCount,
    htmlBytes: byteLength(page.html),
    resourceUrlCount: page.resourceUrls.length,
    domSignalCount: page.domSignals.length,
    capture: page.capture,
    elapsedMs: Date.now() - startedAt
  };
}
