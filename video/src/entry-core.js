import {
  readCollectionCaptureDetails,
  readCollectionCaptureSummaries
} from './collection-capture.js';
import { withSecurityHeaders } from './security-headers.js';
import { blockPlaybackMedia } from './video-blocklist.js';
import { runLivenessMonitor } from './liveness-monitor.js';
import { LIVENESS_CRON } from './liveness-schedule.js';
import { runManualImport } from './manual-import.js';
import { readManualImportJob } from './manual-import-jobs.js';
import { consumeManualImportBatch } from './manual-import-queue.js';
import {
  invalidateOrientationPlaybackCache,
  readOrientationPlaybackCursorPage
} from './oriented-playback-feed.js';
import {
  invalidatePlaybackCache,
  readSeededPlaybackCursorPage
} from './playback-feed.js';
import {
  parseStatusListLimit,
  readPlaybackExclusionStatus,
  readPlaybackExclusionSummary
} from './status-lists.js';
import { readStatusReport } from './status-report.js';
import { normalizeVideoOrientationFilter } from './video-orientation.js';
import { runAllScheduledCollections } from './scheduled-collection.js';
import { runAdminCollector } from './worker.js';

const STATUS_CACHE_TTL_MS = 5 * 60_000;
const STATUS_RESPONSE_HEADERS = Object.freeze([
  ['cache-control', 'private, no-store'],
  ['content-type', 'application/json; charset=utf-8'],
  ['x-content-type-options', 'nosniff']
]);
const PLAYBACK_CACHE_TTL_MS = 30_000;
const PLAYBACK_CACHE_LIMIT = 128;
const ADMIN_COLLECTION_PATHS = Object.freeze([
  '/api/admin/collect-source-a',
  '/api/admin/collect-source-b',
  '/api/admin/collect-source-e'
]);
const PLAYBACK_EXCLUSION_STATUS_PATH = '/api/status/exclusions';
const ADMIN_PLAYBACK_EXCLUSION_STATUS_PATH = '/api/admin/status/exclusions';
const ADMIN_CAPTURE_PATH = '/api/admin/captures';
const ADMIN_IMPORT_JOB_PATH_PREFIX = '/api/admin/import/jobs/';
const PLAYBACK_BLOCK_PATH = '/api/videos/block';
const ADMIN_TOKEN_COOKIE = 'video_scraper_admin_token';
const ADMIN_TOKEN_COOKIE_PREFIX = `${ADMIN_TOKEN_COOKIE}=`;
const statusCaches = new WeakMap();
const playbackCaches = new WeakMap();
let cachedAdminTokenSource;
let cachedAdminToken = '';
let cachedBearerAuthorization = '';

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function adminCookieValue(request) {
  const header = request.headers.get('cookie');
  if (!header) return '';

  let offset = 0;
  while (offset < header.length) {
    while (offset < header.length) {
      const code = header.charCodeAt(offset);
      if (code !== 32 && code !== 9 && code !== 59) break;
      offset += 1;
    }

    if (header.startsWith(ADMIN_TOKEN_COOKIE_PREFIX, offset)) {
      const valueStart = offset + ADMIN_TOKEN_COOKIE_PREFIX.length;
      let valueEnd = header.indexOf(';', valueStart);
      if (valueEnd < 0) valueEnd = header.length;
      while (valueEnd > valueStart) {
        const code = header.charCodeAt(valueEnd - 1);
        if (code !== 32 && code !== 9) break;
        valueEnd -= 1;
      }
      const rawValue = header.slice(valueStart, valueEnd);
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }

    const separator = header.indexOf(';', offset);
    if (separator < 0) return '';
    offset = separator + 1;
  }
  return '';
}

function authorized(request, env) {
  const source = env.ADMIN_TOKEN;
  if (source !== cachedAdminTokenSource) {
    cachedAdminTokenSource = source;
    cachedAdminToken = String(source || '');
    cachedBearerAuthorization = cachedAdminToken ? `Bearer ${cachedAdminToken}` : '';
  }

  if (!cachedAdminToken) return false;
  if (request.headers.get('authorization') === cachedBearerAuthorization) return true;
  return adminCookieValue(request) === cachedAdminToken;
}

function invalidateStatusCache(db) {
  if (db && (typeof db === 'object' || typeof db === 'function')) statusCaches.delete(db);
}

function invalidatePlaybackResponseCache(db) {
  if (db && (typeof db === 'object' || typeof db === 'function')) playbackCaches.delete(db);
}

function invalidateCaches(db, options = {}) {
  invalidateStatusCache(db);
  invalidatePlaybackResponseCache(db);
  invalidatePlaybackCache(db);
  invalidateOrientationPlaybackCache(db, options);
}

function invalidateAfterCollectionGroup(db, results) {
  const sourceResults = (results || []).filter((result) => result?.method !== 'playback-feed-finalize');
  if (!sourceResults.length) return;
  if (sourceResults.some((result) => result?.ok)) invalidateCaches(db);
  else invalidateStatusCache(db);
}

function invalidateAfterLiveness(db, result) {
  invalidateStatusCache(db);
  const deadCount = Number(result?.deadCount || 0);
  const revivedCount = Number(result?.revivedCount || 0);
  if (deadCount <= 0 && revivedCount <= 0) return;

  invalidatePlaybackResponseCache(db);
  invalidatePlaybackCache(db);
  invalidateOrientationPlaybackCache(db, {
    resetMetadata: revivedCount > 0
  });
}

function responseFromSnapshot(snapshot) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    headers: snapshot.headers
  });
}

async function cachedStatusResponse(url, env) {
  const exclusions = url.pathname === PLAYBACK_EXCLUSION_STATUS_PATH;
  const key = exclusions ? 'playback-exclusions-summary' : 'summary';
  let cache = statusCaches.get(env.DB);
  if (!cache) {
    cache = new Map();
    statusCaches.set(env.DB, cache);
  }

  const now = Date.now();
  const existing = cache.get(key);
  if (existing?.snapshot && existing.expiresAt > now) return responseFromSnapshot(existing.snapshot);
  if (existing?.pending) return responseFromSnapshot(await existing.pending);

  const pending = (async () => {
    const data = exclusions
      ? await readPlaybackExclusionSummary(env.DB)
      : await readStatusReport(env);
    return {
      body: JSON.stringify(data),
      status: 200,
      headers: STATUS_RESPONSE_HEADERS
    };
  })();
  cache.set(key, { pending });

  try {
    const snapshot = await pending;
    cache.set(key, { snapshot, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
    return responseFromSnapshot(snapshot);
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

function playbackCacheFor(db) {
  let cache = playbackCaches.get(db);
  if (!cache) {
    cache = new Map();
    playbackCaches.set(db, cache);
  }
  return cache;
}

function trimPlaybackCache(cache) {
  while (cache.size > PLAYBACK_CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function cachedPlaybackPage(env, options) {
  const cache = playbackCacheFor(env.DB);
  const key = `${options.orientation}:${options.seed}:${options.cursor}:${options.limit}`;
  const now = Date.now();
  const existing = cache.get(key);
  if (existing?.page && existing.expiresAt > now) return existing.page;
  if (existing?.pending) return existing.pending;

  const pending = options.orientation === 'both'
    ? readSeededPlaybackCursorPage(env.DB, options)
    : readOrientationPlaybackCursorPage(env.DB, options);
  cache.set(key, { pending, expiresAt: now + PLAYBACK_CACHE_TTL_MS });

  try {
    const page = await pending;
    const expiresAt = Date.now() + PLAYBACK_CACHE_TTL_MS;
    cache.delete(key);
    cache.set(key, { page, expiresAt });
    trimPlaybackCache(cache);
    return page;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function playbackResponse(url, env) {
  const limit = intParam(url.searchParams.get('limit'), 24, 1, 100);
  const cursor = url.searchParams.get('cursor') || 'start';
  const seed = intParam(url.searchParams.get('seed'), 1, 1, 2_147_483_646);
  const orientation = normalizeVideoOrientationFilter(url.searchParams.get('orientation'));
  const page = await cachedPlaybackPage(env, { limit, cursor, seed, orientation });
  return json({
    ok: true,
    seed,
    orientation,
    items: page.items,
    nextCursor: page.nextCursor
  }, { headers: { 'cache-control': 'private, no-store' } });
}

async function runAllAdminCollectors(env, ctx) {
  const task = runAllScheduledCollections(env)
    .then((results) => {
      invalidateAfterCollectionGroup(env.DB, results);
      console.log('manual-all-source-collection-complete', { results });
      return results;
    });

  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}

async function runOneAdminCollector(pathname, env, ctx) {
  const task = runAdminCollector(pathname, env)
    .then((result) => {
      console.log('manual-source-collection-complete', {
        pathname,
        combinedFeedCount: result.combinedFeedCount
      });
      return result;
    })
    .catch((error) => {
      console.error('manual-source-collection-failed', {
        pathname,
        error: String(error?.message || error)
      });
      return null;
    })
    .finally(() => invalidateCaches(env.DB));

  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}

async function blockPlaybackVideo(request, env) {
  if (!authorized(request, env)) return unauthorized();
  const result = await blockPlaybackMedia(env, request);
  if (result.data?.blocked) invalidateCaches(env.DB);
  return json(result.data, { status: result.status });
}

async function readCaptureResponse(url, env) {
  const path = url.pathname;
  if (path === ADMIN_CAPTURE_PATH) {
    const limit = intParam(url.searchParams.get('limit'), 20, 1, 100);
    return json({ ok: true, captures: await readCollectionCaptureSummaries(env.DB, limit) });
  }
  const match = /^\/api\/admin\/captures\/(\d+)$/.exec(path);
  if (!match) return json({ ok: false, error: 'Capture not found' }, { status: 404 });
  const eventLimit = intParam(url.searchParams.get('eventLimit'), 500, 1, 2000);
  const capture = await readCollectionCaptureDetails(env.DB, match[1], eventLimit);
  if (!capture) return json({ ok: false, error: 'Capture not found' }, { status: 404 });
  return json({ ok: true, capture });
}

async function staticAssetResponse(request, env) {
  if (!env.ASSETS?.fetch) return json({ ok: false, error: 'Not found' }, { status: 404 });
  return withSecurityHeaders(await env.ASSETS.fetch(request), env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/videos') {
      if (!authorized(request, env)) return unauthorized();
      return playbackResponse(url, env);
    }
    if (
      method === 'GET'
      && (pathname === '/api/status' || pathname === PLAYBACK_EXCLUSION_STATUS_PATH)
    ) {
      if (!authorized(request, env)) return unauthorized();
      return cachedStatusResponse(url, env);
    }
    if (method === 'GET' && pathname === ADMIN_PLAYBACK_EXCLUSION_STATUS_PATH) {
      if (!authorized(request, env)) return unauthorized();
      const limit = parseStatusListLimit(url.searchParams.get('limit') ?? url.searchParams.get('listLimit'));
      return json(await readPlaybackExclusionStatus(env.DB, limit));
    }
    if (method === 'GET' && pathname.startsWith(ADMIN_CAPTURE_PATH)) {
      if (!authorized(request, env)) return unauthorized();
      return readCaptureResponse(url, env);
    }
    if (method === 'GET' && pathname.startsWith(ADMIN_IMPORT_JOB_PATH_PREFIX)) {
      if (!authorized(request, env)) return unauthorized();
      const jobId = pathname.slice(ADMIN_IMPORT_JOB_PATH_PREFIX.length);
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return json({ ok: false, error: 'Import job not found' }, { status: 404 });
      }
      const job = await readManualImportJob(env.DB, jobId);
      if (!job) return json({ ok: false, error: 'Import job not found' }, { status: 404 });
      return json({ ok: true, job });
    }

    if (method === 'POST' && pathname === PLAYBACK_BLOCK_PATH) {
      return blockPlaybackVideo(request, env);
    }

    if (method === 'POST' && pathname === '/api/admin/refresh') {
      return json({
        ok: false,
        error: 'Endpoint removed',
        replacement: '/api/admin/collect-all'
      }, { status: 410 });
    }

    if (method === 'POST' && ADMIN_COLLECTION_PATHS.includes(pathname)) {
      if (!authorized(request, env)) return unauthorized();
      await runOneAdminCollector(pathname, env, ctx);
      return json({
        ok: true,
        accepted: true,
        source: pathname.split('/').at(-1)
      }, { status: 202 });
    }

    if (method === 'POST' && pathname === '/api/admin/collect-all') {
      if (!authorized(request, env)) return unauthorized();
      await runAllAdminCollectors(env, ctx);
      return json({
        ok: true,
        accepted: true,
        sources: ADMIN_COLLECTION_PATHS.map((path) => path.split('/').at(-1))
      }, { status: 202 });
    }

    if (method === 'POST' && pathname === '/api/admin/import') {
      if (!authorized(request, env)) return unauthorized();
      const result = await runManualImport(request, env);
      if (result.status < 400) {
        if (Number(result.data?.imported || 0) > 0) invalidateCaches(env.DB);
        else invalidateStatusCache(env.DB);
      }
      return json(result.data, { status: result.status });
    }

    if (pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API route not found' }, { status: 404 });
    }
    return staticAssetResponse(request, env);
  },

  async queue(batch, env) {
    const results = await consumeManualImportBatch(batch, env);
    if (results.some((result) => result?.completed)) invalidateCaches(env.DB);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === LIVENESS_CRON) {
      ctx.waitUntil(
        runLivenessMonitor(env)
          .then((result) => {
            invalidateAfterLiveness(env.DB, result);
            return result;
          })
          .catch((error) => {
            invalidateStatusCache(env.DB);
            console.error('scheduled-video-liveness-failed', {
              cron: controller.cron,
              error: String(error?.message || error)
            });
            return null;
          })
      );
      return;
    }


    console.log('scheduled-collection-disabled', { cron: controller.cron });
  }
};
