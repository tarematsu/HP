import puppeteer from '@cloudflare/puppeteer';
import {
  collectionCaptureEnabled,
  collectionCaptureLimits,
  isTextCaptureContentType,
  sanitizeHeaders
} from './collection-capture.js';

const BROWSER_RUN_TIMEOUT_MS = 60_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/26.0 Mobile/15E148 Safari/604.1';
const DEFAULT_ACCEPT_LANGUAGE = 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7';
const DEFAULT_TIMEOUT_MS = BROWSER_RUN_TIMEOUT_MS;
const DEFAULT_SETTLE_MS = 1_500;
const DEFAULT_SCROLLS = 3;
const DEFAULT_LOAD_MORE_CLICKS = 3;
const LOAD_MORE_TEXTS = Object.freeze(['もっと見る', '続きを読み込む', 'もっと読み込む']);
const DEFAULT_VIEWPORT = Object.freeze({
  width: 430,
  height: 932,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});
const ATTRIBUTE_NAMES = Object.freeze([
  'src', 'href', 'poster', 'content', 'srcset', 'data-src', 'data-srcset',
  'data-url', 'data-video-url', 'data-media-url', 'data-download-url',
  'data-href', 'data-permalink', 'data-testid', 'aria-label'
]);

function abortError(signal, fallback = 'Browser source collection aborted') {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

export function throwIfBrowserSourceAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function envValue(env, key, suffix) {
  const sourceKey = String(key || '').toUpperCase();
  return String(env?.[`SOURCE_${sourceKey}_${suffix}`] || env?.[`BROWSER_${suffix}`] || '').trim();
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readJsonHeaders(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const output = {};
    for (const [name, headerValue] of Object.entries(parsed)) {
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) continue;
      if (headerValue === undefined || headerValue === null) continue;
      output[name.toLowerCase()] = String(headerValue);
    }
    return output;
  } catch {
    return {};
  }
}

function browserHeaders(env, key) {
  const headers = {
    'accept-language': envValue(env, key, 'ACCEPT_LANGUAGE') || DEFAULT_ACCEPT_LANGUAGE
  };
  const authorization = envValue(env, key, 'AUTHORIZATION');
  if (authorization) headers.authorization = authorization;
  const extra = {
    ...readJsonHeaders(env?.BROWSER_EXTRA_HEADERS_JSON),
    ...readJsonHeaders(env?.[`SOURCE_${String(key || '').toUpperCase()}_EXTRA_HEADERS_JSON`])
  };
  return { ...headers, ...extra };
}

function cookieHeaderFor(env, key) {
  const sourceKey = String(key || '').toUpperCase();
  return [
    env?.BROWSER_COOKIE,
    env?.[`SOURCE_${sourceKey}_COOKIE`]
  ].map((value) => String(value || '').trim()).filter(Boolean).join('; ');
}

function cookiesFromHeader(cookieHeader, sourceUrl) {
  if (!cookieHeader) return [];
  const cookies = [];
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name || /^(path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name)) continue;
    cookies.push({ name, value, url: sourceUrl });
  }
  return cookies;
}

async function delay(ms, signal) {
  const duration = Math.max(0, Math.floor(Number(ms) || 0));
  if (duration <= 0) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError(signal));
    };
    timer = setTimeout(finish, duration);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function collectDomSignals(page) {
  return page.evaluate((attributeNames) => {
    const values = [];
    const push = (value) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (text) values.push(text);
    };

    push(document.documentElement?.innerText || '');
    for (const element of document.querySelectorAll('*')) {
      for (const name of attributeNames) push(element.getAttribute(name));
      push(element.currentSrc);
      push(element.href);
      push(element.src);
      push(element.action);
      push(element.poster);
    }
    for (const entry of performance.getEntriesByType('resource')) push(entry.name);
    return values;
  }, ATTRIBUTE_NAMES);
}

async function scrollAndSettle(page, env, key, signal) {
  const settleMs = parsePositiveInt(envValue(env, key, 'SETTLE_MS'), DEFAULT_SETTLE_MS, 0, 10_000);
  const scrolls = parsePositiveInt(envValue(env, key, 'SCROLLS'), DEFAULT_SCROLLS, 0, 10);
  if (settleMs) await delay(settleMs, signal);
  for (let index = 0; index < scrolls; index += 1) {
    throwIfBrowserSourceAborted(signal);
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0));
    if (settleMs) await delay(Math.min(settleMs, 1_000), signal);
  }
}

async function clickLoadMoreOnce(page, texts) {
  return page.evaluate((labels) => {
    const normalizedLabels = labels.map((label) => String(label || '').trim()).filter(Boolean);
    const candidates = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')];
    for (const element of candidates) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = `${element.innerText || ''} ${element.textContent || ''} ${element.value || ''} ${element.getAttribute('aria-label') || ''}`.trim();
      if (!text || rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (!normalizedLabels.some((label) => text.includes(label))) continue;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return { clicked: true, text };
    }
    return { clicked: false, text: '' };
  }, texts);
}

async function clickLoadMoreControls(page, env, key, signal, options = {}) {
  const labels = options.loadMoreTexts || LOAD_MORE_TEXTS;
  const maxClicks = parsePositiveInt(
    envValue(env, key, 'LOAD_MORE_CLICKS'),
    options.loadMoreClicks ?? DEFAULT_LOAD_MORE_CLICKS,
    0,
    10
  );
  const settleMs = parsePositiveInt(envValue(env, key, 'SETTLE_MS'), DEFAULT_SETTLE_MS, 0, 10_000);
  let clicks = 0;
  for (let index = 0; index < maxClicks; index += 1) {
    throwIfBrowserSourceAborted(signal);
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0));
    if (settleMs) await delay(Math.min(settleMs, 1_000), signal);
    const result = await clickLoadMoreOnce(page, labels);
    if (!result.clicked) break;
    clicks += 1;
    if (settleMs) await delay(settleMs, signal);
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0));
    if (settleMs) await delay(Math.min(settleMs, 1_000), signal);
  }
  return clicks;
}

function contentLength(headers) {
  const parsed = Number.parseInt(String(headers?.['content-length'] || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function captureResponseBody(response, limits) {
  const headers = response.headers() || {};
  const contentType = headers['content-type'] || '';
  const length = contentLength(headers);
  if (!isTextCaptureContentType(contentType)) return { bodyText: '', bodyBytes: length, bodyTruncated: false };
  if (limits.bodyLimit <= 0) return { bodyText: '', bodyBytes: length, bodyTruncated: true };
  if (length !== null && length > limits.bodyLimit) return { bodyText: '', bodyBytes: length, bodyTruncated: true };
  try {
    const text = await response.text();
    return {
      bodyText: text.slice(0, limits.bodyLimit),
      bodyBytes: new TextEncoder().encode(text).byteLength,
      bodyTruncated: text.length > limits.bodyLimit
    };
  } catch {
    return { bodyText: '', bodyBytes: length, bodyTruncated: true };
  }
}

function setupNetworkCapture(page, env) {
  if (!collectionCaptureEnabled(env)) return { events: [], wait: async () => {} };
  const limits = collectionCaptureLimits(env);
  const events = [];
  const pending = [];
  const addEvent = (event) => {
    if (events.length >= limits.networkLimit) return false;
    events.push(event);
    return true;
  };
  page.on('request', (request) => {
    addEvent({
      eventType: 'request',
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: sanitizeHeaders(request.headers()),
      occurredAt: new Date().toISOString()
    });
  });
  page.on('response', (response) => {
    if (events.length >= limits.networkLimit) return;
    const task = (async () => {
      const request = response.request();
      const headers = response.headers() || {};
      const body = await captureResponseBody(response, limits);
      addEvent({
        eventType: 'response',
        url: response.url(),
        method: request?.method?.() || null,
        resourceType: request?.resourceType?.() || null,
        status: response.status(),
        contentType: headers['content-type'] || '',
        requestHeaders: sanitizeHeaders(request?.headers?.() || {}),
        responseHeaders: sanitizeHeaders(headers),
        occurredAt: new Date().toISOString(),
        ...body
      });
    })().catch(() => {});
    pending.push(task);
  });
  return {
    events,
    async wait() {
      while (pending.length) {
        const current = pending.splice(0);
        await Promise.allSettled(current);
      }
    }
  };
}

export function browserCandidateText(result) {
  return [
    result?.html,
    ...(result?.domSignals || []),
    ...(result?.resourceUrls || [])
  ].filter(Boolean).join('\n');
}

export async function collectBrowserPage(env = {}, key, sourceUrl, signal, options = {}) {
  if (!env?.BROWSER) throw new Error(`Source ${key} requires the BROWSER binding`);
  throwIfBrowserSourceAborted(signal);

  const timeoutMs = parsePositiveInt(
    envValue(env, key, 'TIMEOUT_MS'),
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
    1_000,
    BROWSER_RUN_TIMEOUT_MS
  );
  const waitUntil = envValue(env, key, 'WAIT_UNTIL') || options.waitUntil || 'networkidle2';
  const userAgent = envValue(env, key, 'USER_AGENT') || DEFAULT_USER_AGENT;
  const viewport = {
    ...DEFAULT_VIEWPORT,
    ...(options.viewport || {})
  };
  const resourceUrls = new Set();
  let browser;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.setViewport(viewport);
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders(browserHeaders(env, key));

    const cookies = cookiesFromHeader(cookieHeaderFor(env, key), sourceUrl);
    if (cookies.length) await page.setCookie(...cookies);

    const networkCapture = setupNetworkCapture(page, env);
    page.on('request', (request) => {
      try { resourceUrls.add(request.url()); } catch {}
    });
    page.on('response', (response) => {
      try { resourceUrls.add(response.url()); } catch {}
    });

    const response = await page.goto(sourceUrl, { waitUntil, timeout: timeoutMs });
    throwIfBrowserSourceAborted(signal);
    if (!response) throw new Error(`Source ${key} browser navigation produced no response`);
    if (!response.ok()) throw new Error(`Source ${key} HTTP ${response.status()}`);

    await scrollAndSettle(page, env, key, signal);
    const loadMoreClicks = options.loadMore ? await clickLoadMoreControls(page, env, key, signal, options) : 0;
    throwIfBrowserSourceAborted(signal);
    await networkCapture.wait();

    const html = await page.content();
    const domSignals = await collectDomSignals(page);
    const finalUrl = page.url();
    return {
      sourceUrl,
      finalUrl,
      html,
      htmlBytes: new TextEncoder().encode(html).byteLength,
      domSignals,
      resourceUrls: [...resourceUrls],
      status: response.status(),
      timeoutMs,
      loadMoreClicks,
      userAgent,
      viewport,
      capture: {
        sourceKey: key,
        sourceUrl,
        finalUrl,
        html,
        htmlBytes: new TextEncoder().encode(html).byteLength,
        domSignalCount: domSignals.length,
        resourceUrlCount: resourceUrls.size,
        networkEvents: networkCapture.events,
        timeoutMs,
        loadMoreClicks,
        userAgent,
        viewport
      }
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
