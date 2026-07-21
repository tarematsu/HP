import { browserCandidateText, collectBrowserPage, throwIfBrowserSourceAborted } from './browser-source.js';
import { extractVideoUrls, normalizeMediaHost } from './extractor.js';
import { mediaHostFor, sourceUrlFor } from './source-locator.js';

const REQUEST_TIMEOUT_MS = 60_000;
const BACKSLASH = String.fromCharCode(92);
const LOAD_MORE_TEXTS = Object.freeze(['もっと見る', '続きを読み込む', 'もっと読み込む']);

function normalizeSourceUrl(value) {
  const url = new URL(value || '');
  if (url.protocol !== 'https:') throw new Error('SOURCE_E_URL must use HTTPS');
  url.hash = '';
  return url.toString();
}

export function extractSourceEMediaUrls(value, limit = Infinity, mediaHost = mediaHostFor()) {
  const text = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/&#x3a;|&#58;/gi, ':')
    .replaceAll(`${BACKSLASH}u002f`, '/')
    .replaceAll(`${BACKSLASH}u002F`, '/')
    .replaceAll(`${BACKSLASH}u003a`, ':')
    .replaceAll(`${BACKSLASH}u003A`, ':')
    .replaceAll(`${BACKSLASH}/`, '/');
  return extractVideoUrls(text, limit, normalizeMediaHost(mediaHost));
}

export async function collectSourceEMediaUrls(env = {}, signal) {
  throwIfBrowserSourceAborted(signal);
  const startedAt = Date.now();
  const sourceUrl = normalizeSourceUrl(sourceUrlFor(env, 'E'));
  const page = await collectBrowserPage(env, 'E', sourceUrl, signal, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    loadMore: true,
    loadMoreClicks: 3,
    loadMoreTexts: LOAD_MORE_TEXTS
  });
  throwIfBrowserSourceAborted(signal);

  const html = browserCandidateText(page);
  const urls = extractSourceEMediaUrls(html, Infinity, mediaHostFor(env));
  return {
    sourceUrl,
    finalUrl: page.finalUrl,
    urls,
    clicks: page.loadMoreClicks,
    sourceMode: 'twikeep-browser-direct-list-load-more',
    loadMoreClicks: page.loadMoreClicks,
    directUrlCount: urls.length,
    resourceUrlCount: page.resourceUrls.length,
    domSignalCount: page.domSignals.length,
    capture: page.capture,
    elapsedMs: Date.now() - startedAt
  };
}
