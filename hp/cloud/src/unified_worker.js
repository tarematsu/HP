import homePanelWorker from './worker_core.ts';
import { requestFamily } from './unified_routes.js';
import { refreshTverFeed, shouldRefreshTverFeed, tverFeedResponse } from './tver_feed.js';
import { tverFeedObservability } from './tver_feed_observability.js';
import videoWorker from '../../video/src/entry.js';

export { SchedulerCoordinator } from './scheduler_coordinator.ts';
export { DeviceSyncCoordinator } from './device_sync_coordinator.ts';
export { DeviceExchangeCoordinator } from './device_exchange_coordinator.ts';
export { RadarBundleCoordinator } from './radar_bundle_coordinator.ts';
export { VideoFeedCoordinator } from '../../video/src/entry.js';
export { requestFamily } from './unified_routes.js';

const INTERNAL_SERVICE_HEADER = 'X-HomePanel-Internal-Service';
const INTERNAL_SERVICE_VALUE = 'homepanel-cloud';
const ADMIN_TOKEN_COOKIE = 'video_scraper_admin_token';
const TVER_FEED_PATH = '/v1/native/tver-feed';

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

function integratedVideoFetch(input, init, env, ctx) {
  const request = input instanceof Request && init === undefined
    ? input
    : new Request(input, init);
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

async function unifiedHealthResponse(request, env, ctx) {
  const tverPromise = tverFeedObservability(env);
  try {
    const [videoResponse, tverFeed] = await Promise.all([
      integratedVideoFetch(request, undefined, env, ctx),
      tverPromise,
    ]);
    let videoHealth = {};
    try {
      videoHealth = await videoResponse.json();
    } catch {
    }
    const ok = videoResponse.ok && videoHealth?.ok !== false && tverFeed.ok;
    return Response.json({
      ...videoHealth,
      ok,
      service: 'homepanel-cloud',
      checkedAt: new Date().toISOString(),
      tverFeed,
    }, {
      status: ok ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    const tverFeed = await tverPromise;
    return Response.json({
      ok: false,
      service: 'homepanel-cloud',
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      checkedAt: new Date().toISOString(),
      tverFeed,
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
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

    if (requestFamily(pathname) === 'homepanel') {
      return homePanelWorker.fetch(request, homePanelRuntimeEnv(env, ctx), ctx);
    }

    if (pathname === '/api/health') {
      return unifiedHealthResponse(request, env, ctx);
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

  queue(batch, env, ctx) {
    return videoWorker.queue(batch, videoRuntimeEnv(env), ctx);
  },

  scheduled(controller, env, ctx) {
    const result = videoWorker.scheduled(controller, videoRuntimeEnv(env), ctx);
    if (shouldRefreshTverFeed(controller?.scheduledTime)) {
      ctx.waitUntil(refreshTverFeed(env).catch((error) => {
        console.error('tver-feed-refresh-failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }));
    }
    return result;
  }
};