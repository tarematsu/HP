import homePanelWorker from './worker_core.ts';
import { queueSchedulerWatchdog } from './scheduler_coordinator.ts';
import { spotifyArtistChartHistoryResponse } from './spotify_artist_chart_read.ts';
import { stationheadLeaderboardProbeStatusResponse } from './stationhead_leaderboard_probe_status.ts';
import { requestFamily } from './unified_routes.js';
import { shouldRefreshTverFeed, tverFeedResponse } from './tver_feed_runtime.js';
import { dispatchTverFeedRefresh } from './tver_feed_refresh_coordinator.js';
import { tverFeedObservability } from './tver_feed_observability.js';
import { youtubePlaylistStartResponse } from './youtube_playlist_start.js';

export { SchedulerCoordinator } from './scheduler_coordinator.ts';
export { DeviceSyncCoordinator } from './device_sync_coordinator.ts';
export { DeviceExchangeCoordinator } from './device_exchange_coordinator.ts';
export { RadarBundleCoordinator } from './radar_bundle_coordinator.ts';
export { VideoFeedCoordinator } from './tver_feed_refresh_coordinator.js';
export { requestFamily } from './unified_routes.js';

const INTERNAL_SERVICE_HEADER = 'X-HomePanel-Internal-Service';
const INTERNAL_SERVICE_VALUE = 'homepanel-cloud';
const ADMIN_TOKEN_COOKIE = 'video_scraper_admin_token';
const TVER_FEED_PATH = '/v1/native/tver-feed';
const YOUTUBE_START_PATH = '/v1/native/youtube-start';
const TVER_FEED_HEALTH_PATH = '/api/health/tver-feed';
const STATIONHEAD_LEADERBOARD_PROBE_HEALTH_PATH = '/api/health/stationhead-leaderboard-probe';
const SPOTIFY_ARTIST_CHART_PATH = '/api/spotify-artist-chart';
const RADAR_FRAME_KEY = 'radar/frames/representative/latest.png';
const RADAR_STALE_AFTER_MS = 90 * 60 * 1000;
const VIDEO_LIVENESS_COORDINATOR_NAME = 'video-liveness';
const VIDEO_LIVENESS_COORDINATOR_URL = 'https://homepanel.internal/video-liveness-run';

let videoWorkerPromise;

function loadVideoWorker() {
  if (!videoWorkerPromise) {
    videoWorkerPromise = import('../../video/src/entry.js').then((module) => module.default);
  }
  return videoWorkerPromise;
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

function videoApiAuthorized(request, env) {
  const token = String(env?.ADMIN_TOKEN || '');
  if (!token) return false;
  if (request.headers.get('authorization') === `Bearer ${token}`) return true;
  return cookieValue(request, ADMIN_TOKEN_COOKIE) === token;
}

function unauthorizedVideoResponse() {
  return Response.json({ ok: false, error: 'Unauthorized' }, {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function unavailableVideoResponse() {
  return Response.json({
    ok: false,
    error: 'Video runtime unavailable',
    retryable: true
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': '60',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function internalVideoRequest(request) {
  const headers = new Headers(request.headers);
  headers.set(INTERNAL_SERVICE_HEADER, INTERNAL_SERVICE_VALUE);
  return new Request(request, { headers });
}

function videoRuntimeEnv(env) {
  return {
    ...env,
    SCHEDULER_COORDINATOR: env?.VIDEO_FEED_COORDINATOR
  };
}

async function integratedVideoFetch(input, init, env, ctx) {
  const request = input instanceof Request && init === undefined
    ? input
    : new Request(input, init);
  const videoWorker = await loadVideoWorker();
  return videoWorker.fetch(
    internalVideoRequest(request),
    videoRuntimeEnv(env),
    ctx
  );
}

function homePanelRuntimeEnv(env, ctx) {
  return {
    ...env,
    VIDEO_SERVICE: {
      fetch(input, init) {
        return integratedVideoFetch(input, init, env, ctx);
      }
    }
  };
}

async function dispatchVideoLiveness(env) {
  const namespace = env?.VIDEO_FEED_COORDINATOR;
  if (!namespace?.getByName) {
    throw new Error('VIDEO_FEED_COORDINATOR binding unavailable');
  }
  const response = await namespace
    .getByName(VIDEO_LIVENESS_COORDINATOR_NAME)
    .fetch(VIDEO_LIVENESS_COORDINATOR_URL, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`video liveness coordinator returned ${response.status}`);
  }
  return response.json();
}

async function radarFrameObservability(env) {
  const checkedAt = Date.now();
  if (!env?.UPDATE_BUCKET) {
    return {
      ok: false,
      status: 'unavailable',
      checkedAt: new Date(checkedAt).toISOString(),
      error: 'UPDATE_BUCKET binding unavailable',
    };
  }
  try {
    const frame = await env.UPDATE_BUCKET.head(RADAR_FRAME_KEY);
    if (!frame) {
      return {
        ok: false,
        status: 'missing',
        checkedAt: new Date(checkedAt).toISOString(),
        lastSuccessAt: null,
        ageSeconds: null,
        staleAfterSeconds: RADAR_STALE_AFTER_MS / 1000,
      };
    }
    const uploadedAt = frame.uploaded instanceof Date
      ? frame.uploaded.getTime()
      : Date.parse(String(frame.uploaded || ''));
    const ageMs = Number.isFinite(uploadedAt) ? Math.max(0, checkedAt - uploadedAt) : Infinity;
    const stale = ageMs > RADAR_STALE_AFTER_MS;
    return {
      ok: !stale,
      status: stale ? 'stale' : 'fresh',
      checkedAt: new Date(checkedAt).toISOString(),
      lastSuccessAt: Number.isFinite(uploadedAt) ? new Date(uploadedAt).toISOString() : null,
      ageSeconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
      staleAfterSeconds: RADAR_STALE_AFTER_MS / 1000,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      checkedAt: new Date(checkedAt).toISOString(),
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    };
  }
}

async function tverFeedHealthResponse(env) {
  const health = await tverFeedObservability(env);
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function videoDatabaseHealth(env) {
  const checkedAt = new Date().toISOString();
  try {
    const row = await env?.DB?.prepare?.('SELECT 1 AS ok')?.first?.();
    const ok = Number(row?.ok) === 1;
    return {
      ok,
      service: 'homepanel-video',
      checkedAt,
      ...(ok ? {} : { error: 'DB health check failed' }),
    };
  } catch (error) {
    return {
      ok: false,
      service: 'homepanel-video',
      checkedAt,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    };
  }
}

async function homePanelCloudHealthResponse(env) {
  const [videoHealth, tverFeed, radar] = await Promise.all([
    videoDatabaseHealth(env),
    tverFeedObservability(env),
    radarFrameObservability(env),
  ]);
  const ok = videoHealth.ok === true;
  return Response.json({
    ...videoHealth,
    ok,
    tverFeed,
    radar,
  }, {
    status: ok ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === TVER_FEED_PATH) {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
        });
      }
      return tverFeedResponse(env, ctx);
    }

    if (pathname === YOUTUBE_START_PATH) {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
        });
      }
      return youtubePlaylistStartResponse();
    }

    if (requestFamily(pathname) === 'homepanel') {
      return homePanelWorker.fetch(request, homePanelRuntimeEnv(env, ctx), ctx);
    }

    if (pathname === TVER_FEED_HEALTH_PATH) {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
        });
      }
      return tverFeedHealthResponse(env);
    }

    if (pathname === STATIONHEAD_LEADERBOARD_PROBE_HEALTH_PATH) {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
        });
      }
      return stationheadLeaderboardProbeStatusResponse(env);
    }

    if (pathname === SPOTIFY_ARTIST_CHART_PATH) {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
        });
      }
      return spotifyArtistChartHistoryResponse(request, env);
    }

    if (pathname === '/api/health') {
      return homePanelCloudHealthResponse(env);
    }

    if (pathname.startsWith('/api/') && !videoApiAuthorized(request, env)) {
      return unauthorizedVideoResponse();
    }

    try {
      return await integratedVideoFetch(request, undefined, env, ctx);
    } catch (error) {
      console.error('video-runtime-request-failed', {
        pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      return unavailableVideoResponse();
    }
  },

  async queue(batch, env, ctx) {
    const videoWorker = await loadVideoWorker();
    return videoWorker.queue(batch, videoRuntimeEnv(env), ctx);
  },

  scheduled(controller, env, ctx) {
    queueSchedulerWatchdog(env, ctx, controller?.scheduledTime);
    ctx.waitUntil(dispatchVideoLiveness(env).catch((error) => {
      console.error('scheduled-video-liveness-dispatch-failed', {
        cron: controller?.cron,
        error: String(error?.message || error)
      });
    }));
    if (shouldRefreshTverFeed(controller?.scheduledTime)) {
      ctx.waitUntil(dispatchTverFeedRefresh(env).catch((error) => {
        console.error('tver-feed-refresh-dispatch-failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }));
    }
  }
};