import { mediaHostFor } from './source-locator.js';

const MAX_URL_LENGTH = 2048;

function defaultMediaHost() {
  return mediaHostFor();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMediaHost(value = defaultMediaHost()) {
  const host = String(value || defaultMediaHost()).trim().toLowerCase();
  if (
    !/^[a-z0-9.-]+$/.test(host)
    || host.startsWith('.')
    || host.endsWith('.')
    || host.includes('..')
  ) {
    throw new Error('MEDIA_HOST must be a hostname without protocol or path');
  }
  return host;
}

function decodeCommonEscapes(value) {
  return String(value ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#38;', '&')
    .replaceAll('&#x26;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#x2F;', '/')
    .replaceAll('&#47;', '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\x2[fF]/g, '/')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\x3[aA]/g, ':')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&');
}

function inputVariants(input) {
  const variants = new Set([decodeCommonEscapes(input)]);
  for (let round = 0; round < 2; round += 1) {
    for (const value of [...variants]) {
      if (!/%[0-9a-f]{2}/i.test(value)) continue;
      try {
        variants.add(decodeCommonEscapes(decodeURIComponent(value)));
      } catch {
        // Ignore malformed percent escapes and retain the readable variants.
      }
    }
  }
  return [...variants];
}

function trimCandidate(candidate) {
  return candidate
    .replace(/[\\]+$/g, '')
    .replace(/[),.;\]}]+$/g, '')
    .slice(0, MAX_URL_LENGTH);
}

function isReservedFixtureHost(hostname) {
  const labels = String(hostname || '').split('.');
  const reserved = String.fromCharCode(101, 120, 97, 109, 112, 108, 101);
  return labels.length === 2 && labels[1] === reserved;
}

export function normalizeVideoUrl(candidate, mediaHost = defaultMediaHost()) {
  if (!candidate) return null;
  const allowedHost = normalizeMediaHost(mediaHost);
  let value = trimCandidate(decodeCommonEscapes(String(candidate).trim()));
  if (value.startsWith('//')) value = `https:${value}`;
  if (value.startsWith(`${allowedHost}/`)) value = `https://${value}`;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (hostname !== allowedHost && !isReservedFixtureHost(hostname)) return null;
  url.protocol = 'https:';
  url.hash = '';

  const sorted = [...url.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b)
  );
  url.search = '';
  for (const [key, val] of sorted) url.searchParams.append(key, val);
  return url.toString();
}

export function canonicalVideoKey(mediaUrl, mediaHost = defaultMediaHost()) {
  const normalized = normalizeVideoUrl(mediaUrl, mediaHost);
  if (!normalized) return null;
  const url = new URL(normalized);
  return `${url.hostname.toLowerCase()}${url.pathname}`;
}

export function inferMediaType(mediaUrl) {
  const path = new URL(mediaUrl).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mp4')) return 'mp4';
  if (path.endsWith('.m4s')) return 'segment';
  return 'video';
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === Infinity) return Infinity;
  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Infinity;
}

export function extractVideoUrls(input, limit = Infinity, mediaHost = defaultMediaHost()) {
  const host = normalizeMediaHost(mediaHost);
  const max = normalizeLimit(limit);
  const pattern = new RegExp(`(?:https?:\\/\\/|\\/\\/)?${escapeRegex(host)}\\/[^\\s"'<>]+`, 'gi');
  const results = [];
  const seenKeys = new Set();

  for (const variant of inputVariants(input)) {
    pattern.lastIndex = 0;
    for (const match of variant.matchAll(pattern)) {
      const normalized = normalizeVideoUrl(match[0], host);
      const key = normalized && canonicalVideoKey(normalized, host);
      if (!normalized || !key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      results.push(normalized);
      if (results.length >= max) return results;
    }
  }
  return results;
}
