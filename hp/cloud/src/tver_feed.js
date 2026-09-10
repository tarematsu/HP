import puppeteer from '@cloudflare/puppeteer';

const TVER_ORIGIN = 'https://tver.jp';
const TVER_TALENT_ID = 't04c4bf';
const TVER_TALENT_URL = `${TVER_ORIGIN}/talents/${TVER_TALENT_ID}`;
const SAKAMICHI_DB_URL = 'https://sakamichidb.anosaka.com/tver_programs/?talent=%E6%AB%BB%E5%9D%8246&sort=custom';
const FEED_OBJECT_KEY = 'native/tver-feed.json';
const BROWSER_TIMEOUT_MS = 45_000;
const MAX_NETWORK_BODIES = 32;
const MAX_NETWORK_BODY_BYTES = 2 * 1024 * 1024;
const MAX_EPISODES = 200;
const MAX_FEED_AGE_MS = 12 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeUrlEscapes(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\\//g, '/');
}

export function normalizeTverEpisodeUrl(value) {
  if (!value) return '';
  const decoded = decodeUrlEscapes(value).trim();
  try {
    const url = new URL(decoded, TVER_ORIGIN);
    if (url.protocol !== 'https:' || url.hostname !== 'tver.jp') return '';
    if (!/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return '';
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function expirationMillis(value, now = new Date()) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    return text.length <= 10 ? numeric * 1000 : numeric;
  }

  const exactLabel = text.match(
    /(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日(?:\([^)]*\))?\s*(?:(\d{1,2})時\s*(\d{1,2})分|(\d{1,2}):(\d{2}))\s*終了予定/
  );
  if (exactLabel) {
    const explicitYear = exactLabel[1] ? Number(exactLabel[1]) : null;
    const month = Number(exactLabel[2]);
    const day = Number(exactLabel[3]);
    const hour = Number(exactLabel[4] || exactLabel[6]);
    const minute = Number(exactLabel[5] || exactLabel[7]);
    const shiftedNow = new Date(now.getTime() + JST_OFFSET_MS);
    const currentJstYear = shiftedNow.getUTCFullYear();
    const years = explicitYear
      ? [explicitYear]
      : [currentJstYear - 1, currentJstYear, currentJstYear + 1];
    const candidates = years
      .map((year) => {
        const ms = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
        const shifted = new Date(ms + JST_OFFSET_MS);
        if (shifted.getUTCFullYear() !== year
            || shifted.getUTCMonth() !== month - 1
            || shifted.getUTCDate() !== day
            || shifted.getUTCHours() !== hour
            || shifted.getUTCMinutes() !== minute) {
          return Number.NaN;
        }
        return ms;
      })
      .filter(Number.isFinite)
      .sort((left, right) => Math.abs(left - now.getTime()) - Math.abs(right - now.getTime()));
    if (candidates.length) return candidates[0];
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseTverExpiration(value, now = new Date()) {
  const ms = expirationMillis(value, now);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function episodeExpirationFromObject(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const candidates = [
    value.endAt,
    value.end_at,
    value.expiresAt,
    value.expireAt,
    value.availableUntil,
    value.content?.endAt,
    value.content?.end_at,
    value.content?.expiresAt,
    value.content?.expireAt,
    value.content?.availableUntil,
  ];
  for (const candidate of candidates) {
    const expiresAt = parseTverExpiration(candidate, now);
    if (expiresAt) return expiresAt;
  }
  return '';
}

function addEpisodeRecord(output, value, expiresAt = '', now = new Date()) {
  const url = normalizeTverEpisodeUrl(
    typeof value === 'string' ? value : value?.url
  );
  if (!url) return;
  const normalizedExpiry = parseTverExpiration(
    expiresAt || (typeof value === 'object' ? value?.expiresAt || value?.endAt : ''),
    now
  );
  const existing = output.get(url);
  if (!existing) {
    output.set(url, normalizedExpiry ? { url, expiresAt: normalizedExpiry } : { url });
    return;
  }
  if (!normalizedExpiry) return;
  if (!existing.expiresAt || Date.parse(normalizedExpiry) < Date.parse(existing.expiresAt)) {
    output.set(url, { url, expiresAt: normalizedExpiry });
  }
}

export function extractTverEpisodeUrls(value) {
  const output = new Set();
  const text = decodeUrlEscapes(value);
  const pattern = /(?:https?:\/\/tver\.jp)?\/episodes\/[A-Za-z0-9_-]+\/?(?:[?#][^\s"'<>]*)?/gi;
  for (const match of text.matchAll(pattern)) {
    const normalized = normalizeTverEpisodeUrl(match[0]);
    if (normalized) output.add(normalized);
  }
  return [...output];
}

function episodeIdFromTypedObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const type = String(value.type || value.content_type || value.contentType || '').toLowerCase();
  if (type !== 'episode') return '';
  const candidates = [
    value.episodeId,
    value.episode_id,
    value.id,
    value.content?.id,
    value.content?.episodeId,
    value.content?.episode_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{6,}$/.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

function collectEpisodeRecordsFromJson(value, output, depth = 0, now = new Date()) {
  if (depth > 10 || value === null || value === undefined || output.size >= MAX_EPISODES) return;
  if (typeof value === 'string') {
    for (const url of extractTverEpisodeUrls(value)) addEpisodeRecord(output, url, '', now);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEpisodeRecordsFromJson(item, output, depth + 1, now);
    return;
  }
  if (typeof value !== 'object') return;

  const expiresAt = episodeExpirationFromObject(value, now);
  const typedEpisodeId = episodeIdFromTypedObject(value);
  if (typedEpisodeId) addEpisodeRecord(output, `/episodes/${typedEpisodeId}`, expiresAt, now);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      if (/episode[_-]?id/i.test(key) && /^[A-Za-z0-9_-]{6,}$/.test(child)) {
        addEpisodeRecord(output, `/episodes/${child}`, expiresAt, now);
      }
      const directUrl = normalizeTverEpisodeUrl(child);
      if (directUrl) addEpisodeRecord(output, directUrl, expiresAt, now);
    }
    collectEpisodeRecordsFromJson(child, output, depth + 1, now);
    if (output.size >= MAX_EPISODES) return;
  }
}

function collectEpisodeCandidates(text, output, now = new Date()) {
  for (const url of extractTverEpisodeUrls(text)) addEpisodeRecord(output, url, '', now);
  try {
    collectEpisodeRecordsFromJson(JSON.parse(text), output, 0, now);
  } catch {
  }
}

async function collectTalentEpisodes(env) {
  if (!env?.BROWSER) throw new Error('TVer feed requires the BROWSER binding');
  const domOutput = new Map();
  const networkFallback = new Map();
  const networkTasks = [];
  const collectedAt = new Date();
  let capturedBodies = 0;
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7' });

    page.on('response', (response) => {
      if (capturedBodies >= MAX_NETWORK_BODIES) return;
      const url = response.url();
      if (!url.startsWith(TVER_ORIGIN) && !url.includes('tver.jp')) return;
      const headers = response.headers() || {};
      const contentType = String(headers['content-type'] || '');
      if (!/application\/(?:json|ld\+json)|text\/json/i.test(contentType)) return;
      const length = Number.parseInt(String(headers['content-length'] || ''), 10);
      if (Number.isFinite(length) && length > MAX_NETWORK_BODY_BYTES) return;
      capturedBodies += 1;
      networkTasks.push(
        response.text()
          .then((text) => {
            if (text.length > MAX_NETWORK_BODY_BYTES) return;
            // Recommendation/ranking JSON can contain unrelated content. Network
            // extraction is only a DOM fallback, is tied to the talent id, and
            // accepts only explicit episode URLs/episode-typed ids.
            if (!url.includes(TVER_TALENT_ID) && !text.includes(TVER_TALENT_ID)) return;
            collectEpisodeCandidates(text, networkFallback, collectedAt);
          })
          .catch(() => {})
      );
    });

    const response = await page.goto(TVER_TALENT_URL, { waitUntil: 'networkidle2', timeout: BROWSER_TIMEOUT_MS });
    if (!response || !response.ok()) {
      throw new Error(`TVer talent page HTTP ${response ? response.status() : 'no-response'}`);
    }
    await delay(1_000);
    for (let index = 0; index < 4; index += 1) {
      await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0));
      await delay(750);
    }

    const links = await page.evaluate(() => {
      const excludedHeading = /^(?:あなたにおすすめ|おすすめ|関連番組|関連動画|ランキング)$/;
      const expiryLabel = /(?:\d{4}年)?\s*\d{1,2}月\s*\d{1,2}日(?:\([^)]*\))?\s*(?:\d{1,2}時\s*\d{1,2}分|\d{1,2}:\d{2})\s*終了予定/;
      const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
      const belongsToExcludedSection = link => {
        let scope = link.parentElement;
        for (let depth = 0; scope && depth < 7 && scope !== document.body; ++depth, scope = scope.parentElement) {
          const headings = Array.from(scope.children || [])
            .filter(child => child.matches?.('h1,h2,h3,h4,h5,h6,[role="heading"]'));
          if (headings.length === 1 && excludedHeading.test(normalize(headings[0].textContent))) return true;
        }
        return false;
      };
      const expirationLabelFor = link => {
        let scope = link;
        for (let depth = 0; scope && depth < 6 && scope !== document.body; ++depth, scope = scope.parentElement) {
          const match = normalize(scope.textContent).match(expiryLabel);
          if (match) return match[0];
        }
        return '';
      };
      return Array.from(document.querySelectorAll('a[href*="/episodes/"]'))
        .filter(link => !belongsToExcludedSection(link))
        .map(element => ({
          url: element.href || element.getAttribute('href') || '',
          expirationLabel: expirationLabelFor(element),
        }));
    });
    for (const link of links) {
      addEpisodeRecord(domOutput, link.url, link.expirationLabel, collectedAt);
    }
    await Promise.allSettled(networkTasks);
    if (domOutput.size) {
      for (const [url, record] of networkFallback) {
        if (domOutput.has(url) && record.expiresAt) {
          addEpisodeRecord(domOutput, url, record.expiresAt, collectedAt);
        }
      }
    } else {
      for (const [url, record] of networkFallback) domOutput.set(url, record);
    }
    return [...domOutput.values()].slice(0, MAX_EPISODES);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function collectSakamichiDbEpisodes(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
  const response = await fetchImpl(SAKAMICHI_DB_URL, {
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
      'user-agent': USER_AGENT
    }
  });
  if (!response.ok) throw new Error(`SakamichiDB HTTP ${response.status}`);
  const text = await response.text();
  return extractTverEpisodeUrls(text).slice(0, MAX_EPISODES);
}

function normalizeEpisodeRecords(values, now = new Date()) {
  const output = new Map();
  for (const value of values || []) addEpisodeRecord(output, value, '', now);
  return [...output.values()];
}

export function filterEpisodesBeforeNextRefresh(episodes, now = new Date()) {
  const cutoff = now.getTime() + REFRESH_INTERVAL_MS;
  return (episodes || []).filter((episode) => {
    const expiresAt = expirationMillis(episode?.expiresAt, now);
    return !Number.isFinite(expiresAt) || expiresAt > cutoff;
  });
}

function buildFeed(episodes, sources, now = new Date()) {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources,
    episodeCount: episodes.length,
    episodes,
  };
}

export async function refreshTverFeed(env, dependencies = {}) {
  if (!env?.DATA_BUCKET) throw new Error('TVer feed requires DATA_BUCKET');
  const collectTalent = dependencies.collectTalent || collectTalentEpisodes;
  const collectSakamichi = dependencies.collectSakamichi || collectSakamichiDbEpisodes;
  const now = dependencies.now || new Date();
  const results = await Promise.allSettled([
    collectTalent(env),
    collectSakamichi(dependencies.fetchImpl || globalThis.fetch)
  ]);

  const talentEpisodes = results[0].status === 'fulfilled'
    ? normalizeEpisodeRecords(results[0].value, now)
    : [];
  const sakamichiEpisodes = results[1].status === 'fulfilled'
    ? normalizeEpisodeRecords(results[1].value, now)
    : [];
  // TVer's talent page is authoritative when it yields episodes. SakamichiDB is
  // a discovery fallback, not a union source, so stale third-party links cannot
  // re-introduce expired items beside a healthy TVer result.
  const selected = talentEpisodes.length ? talentEpisodes : sakamichiEpisodes;
  const episodes = filterEpisodesBeforeNextRefresh(selected, now).slice(0, MAX_EPISODES);
  const sources = talentEpisodes.length ? ['tver-talent']
    : sakamichiEpisodes.length ? ['sakamichidb'] : [];
  if (!episodes.length) {
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`TVer episode collection returned zero playable URLs${failures.length ? `: ${failures.join('; ')}` : ''}`);
  }

  const feed = buildFeed(episodes, sources, now);
  await env.DATA_BUCKET.put(FEED_OBJECT_KEY, JSON.stringify(feed), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      generatedAt: feed.generatedAt,
      episodeCount: String(feed.episodeCount)
    }
  });
  return feed;
}

export function shouldRefreshTverFeed(scheduledTime = Date.now()) {
  const date = new Date(Number(scheduledTime) || Date.now());
  return date.getUTCMinutes() === 0;
}

export async function tverFeedResponse(env) {
  if (!env?.DATA_BUCKET) {
    return Response.json({ ok: false, error: 'TVer feed storage unavailable' }, { status: 503 });
  }
  const object = await env.DATA_BUCKET.get(FEED_OBJECT_KEY);
  if (!object) {
    return Response.json({ ok: false, error: 'TVer feed unavailable', retryable: true }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const generatedAtMs = Date.parse(object.customMetadata?.generatedAt || '');
  const ageMs = Date.now() - generatedAtMs;
  if (!Number.isFinite(generatedAtMs) || ageMs > MAX_FEED_AGE_MS || ageMs < -60 * 60 * 1000) {
    return Response.json({ ok: false, error: 'TVer feed stale', retryable: true }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
    });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-if-error=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export const TVER_FEED_OBJECT_KEY = FEED_OBJECT_KEY;
export const TVER_FEED_TALENT_URL = TVER_TALENT_URL;
export const TVER_FEED_SAKAMICHI_DB_URL = SAKAMICHI_DB_URL;
