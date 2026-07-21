const MAX_ITEMS = 60;
const RESOLVE_MAX_MS = 25_000;
const BATCH_SIZE = 4;
const ITEM_TIMEOUT_MS = 4_000;
const RESOLVER_BYTES = Object.freeze([105,117,117,113,116,58,47,47,100,101,111,46,116,122,111,101,106,100,98,117,106,112,111,46,117,120,106,110,104,46,100,112,110,47,117,120,102,102,117,45,115,102,116,118,109,117]);
const BACKSLASH = String.fromCharCode(92);

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === Infinity) return Infinity;
  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Infinity;
}

function unshiftCode(code) {
  if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + 25) % 26) + 65);
  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + 25) % 26) + 97);
  return String.fromCharCode(code);
}

function resolverBaseUrl(env) {
  if (env?.RESOLVER_BASE_URL) return env.RESOLVER_BASE_URL;
  return RESOLVER_BYTES.map(unshiftCode).join('');
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('item resolver aborted');
  }
}

async function runWithAbortTimeout(task, signal, timeoutMs, label) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(signal.reason instanceof Error ? signal.reason : new Error('item resolver aborted'));
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function normalizeSignalText(value) {
  let text = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replaceAll(`${BACKSLASH}u002f`, '/')
    .replaceAll(`${BACKSLASH}u002F`, '/')
    .replaceAll(`${BACKSLASH}u003a`, ':')
    .replaceAll(`${BACKSLASH}u003A`, ':')
    .replaceAll(`${BACKSLASH}/`, '/');
  if (/%(?:2f|3a)/i.test(text)) {
    try {
      text += ` ${decodeURIComponent(text)}`;
    } catch {}
  }
  return text;
}

export function extractItemIds(values, limit = Infinity) {
  const ids = [];
  const seen = new Set();
  const max = normalizeLimit(limit);
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(?:i\/web\/|[^\s"'<>/]+\/)?status\/(\d{6,})/gi,
    /(?:^|[\s"'=:/])status(?:\/|%2f)(\d{6,})/gi,
    /(?:tweet[_-]?id|status[_-]?id)["']?\s*[:=]\s*["']?(\d{6,})/gi,
    /data-(?:tweet|status)-id=["'](\d{6,})["']/gi
  ];
  for (const value of values || []) {
    const text = normalizeSignalText(value);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (seen.has(match[1])) continue;
        seen.add(match[1]);
        ids.push(match[1]);
        if (ids.length >= max) return ids;
      }
    }
  }
  return ids;
}

export function extractTweetIds(values, limit = Infinity) {
  return extractItemIds(values, limit);
}

export function extractBestMp4Urls(value, limit = Infinity) {
  const output = [];
  const seen = new Set();
  const max = normalizeLimit(limit);
  function add(url) {
    if (typeof url !== 'string' || seen.has(url) || output.length >= max) return;
    if (!/\.mp4(?:\?|$)/i.test(url)) return;
    seen.add(url);
    output.push(url);
  }
  function visit(node) {
    if (!node || typeof node !== 'object' || output.length >= max) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
        if (output.length >= max) return;
      }
      return;
    }
    if (Array.isArray(node.variants)) {
      const candidate = node.variants
        .filter((variant) => typeof variant?.url === 'string' && (/video\/mp4/i.test(variant.content_type || '') || /\.mp4(?:\?|$)/i.test(variant.url)))
        .sort((left, right) => Number(right.bitrate || 0) - Number(left.bitrate || 0))[0];
      if (candidate?.url) add(candidate.url);
    }
    for (const nested of Object.values(node)) {
      visit(nested);
      if (output.length >= max) return;
    }
  }
  visit(value);
  return output;
}

export function itemResolverToken(id) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return ((numeric / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function tweetSyndicationToken(id) {
  return itemResolverToken(id);
}

async function fetchItemJson(fetchImpl, url, signal, timeoutMs) {
  return runWithAbortTimeout(async (requestSignal) => {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'application/json' },
      signal: requestSignal
    });
    if (!response.ok) return null;
    return response.json();
  }, signal, timeoutMs, 'item fetch');
}

async function resolveOneItem(fetchImpl, id, signal, deadlineMs, requestState, env) {
  const base = `${resolverBaseUrl(env)}?id=${encodeURIComponent(id)}&lang=ja`;
  const token = itemResolverToken(id);
  const candidates = [token ? `${base}&token=${encodeURIComponent(token)}` : null, base, `${base}&token=0`].filter(Boolean);
  for (const url of [...new Set(candidates)]) {
    throwIfAborted(signal);
    if (requestState.remaining <= 0) return [];
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) return [];
    requestState.remaining -= 1;
    requestState.used += 1;
    try {
      const data = await fetchItemJson(fetchImpl, url, signal, Math.max(1, Math.min(ITEM_TIMEOUT_MS, remainingMs)));
      const urls = extractBestMp4Urls(data, 4);
      if (urls.length) return urls;
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
    }
  }
  return [];
}

export async function resolveItemVideos(_browser, itemIds, maxVideos = itemIds.length, batchSize = BATCH_SIZE, signal, fetchImpl = globalThis.fetch, options = {}, env = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const ids = [...new Set((itemIds || []).map(String).filter((id) => /^\d+$/.test(id)))].slice(0, MAX_ITEMS);
  if (!ids.length || maxVideos <= 0) return [];
  const limit = Math.max(1, Math.floor(Number(maxVideos) || ids.length));
  const size = Math.max(1, Math.min(Math.floor(Number(batchSize) || BATCH_SIZE), 8));
  const deadlineMs = Date.now() + RESOLVE_MAX_MS;
  const requestState = { remaining: Math.max(1, Math.floor(Number(options.maxRequests) || Number.MAX_SAFE_INTEGER)), used: 0 };
  const output = new Set();
  for (let offset = 0; offset < ids.length && output.size < limit; offset += size) {
    throwIfAborted(signal);
    if (Date.now() >= deadlineMs || requestState.remaining <= 0) break;
    const results = await Promise.all(ids.slice(offset, offset + size).map((id) => resolveOneItem(fetchImpl, id, signal, deadlineMs, requestState, env)));
    for (const urls of results) {
      for (const url of urls) {
        output.add(url);
        if (output.size >= limit) return [...output];
      }
    }
  }
  return [...output];
}

export async function resolveTweetVideos(browser, tweetIds, maxVideos = tweetIds.length, batchSize = BATCH_SIZE, signal, fetchImpl = globalThis.fetch, options = {}) {
  return resolveItemVideos(browser, tweetIds, maxVideos, batchSize, signal, fetchImpl, options);
}
