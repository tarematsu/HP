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

function addEpisodeUrl(output, value) {
  const normalized = normalizeTverEpisodeUrl(value);
  if (normalized) output.add(normalized);
}

export function extractTverEpisodeUrls(value) {
  const output = new Set();
  const text = decodeUrlEscapes(value);
  const pattern = /(?:https?:\/\/tver\.jp)?\/episodes\/[A-Za-z0-9_-]+\/?(?:[?#][^\s"'<>]*)?/gi;
  for (const match of text.matchAll(pattern)) addEpisodeUrl(output, match[0]);
  return [...output];
}

function collectEpisodeIdsFromJson(value, output, depth = 0) {
  if (depth > 10 || value === null || value === undefined || output.size >= MAX_EPISODES) return;
  if (typeof value === 'string') {
    for (const url of extractTverEpisodeUrls(value)) output.add(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEpisodeIdsFromJson(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && /(?:episode|content)[_-]?id/i.test(key)
        && /^[A-Za-z0-9_-]{6,}$/.test(child)) {
      addEpisodeUrl(output, `/episodes/${child}`);
    }
    collectEpisodeIdsFromJson(child, output, depth + 1);
    if (output.size >= MAX_EPISODES) return;
  }
}

function collectEpisodeCandidates(text, output) {
  for (const url of extractTverEpisodeUrls(text)) output.add(url);
  try {
    collectEpisodeIdsFromJson(JSON.parse(text), output);
  } catch {
  }
}

async function collectTalentEpisodes(env) {
  if (!env?.BROWSER) throw new Error('TVer feed requires the BROWSER binding');
  const domOutput = new Set();
  const networkFallback = new Set();
  const networkTasks = [];
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
            // Recommendation/ranking JSON can contain unrelated episodes. Keep
            // network extraction as a fallback and require the talent identifier.
            if (!url.includes(TVER_TALENT_ID) && !text.includes(TVER_TALENT_ID)) return;
            collectEpisodeCandidates(text, networkFallback);
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
      return Array.from(document.querySelectorAll('a[href*="/episodes/"]'))
        .filter(link => !belongsToExcludedSection(link))
        .map(element => element.href || element.getAttribute('href') || '');
    });
    for (const link of links) addEpisodeUrl(domOutput, link);
    await Promise.allSettled(networkTasks);
    if (!domOutput.size) {
      for (const url of networkFallback) domOutput.add(url);
    }
    return [...domOutput].slice(0, MAX_EPISODES);
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

function buildFeed(urls, sources, now = new Date()) {
  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources,
    episodeCount: urls.length,
    episodes: urls.map((url) => ({ url }))
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
  const urls = new Set();
  const sources = [];
  if (results[0].status === 'fulfilled') {
    for (const url of results[0].value) addEpisodeUrl(urls, url);
    if (results[0].value.length) sources.push('tver-talent');
  }
  if (results[1].status === 'fulfilled') {
    for (const url of results[1].value) addEpisodeUrl(urls, url);
    if (results[1].value.length) sources.push('sakamichidb');
  }
  const episodeUrls = [...urls].slice(0, MAX_EPISODES);
  if (!episodeUrls.length) {
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`TVer episode collection returned zero URLs${failures.length ? `: ${failures.join('; ')}` : ''}`);
  }

  const feed = buildFeed(episodeUrls, sources, now);
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
  return date.getUTCMinutes() === 0 && date.getUTCHours() % 3 === 0;
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
