import homePanelWorker from './worker_core.ts';
import { requestFamily } from './unified_routes.js';

export { SchedulerCoordinator } from './scheduler_coordinator.ts';
export { DeviceSyncCoordinator } from './device_sync_coordinator.ts';
export { RadarBundleCoordinator } from './radar_bundle_coordinator.ts';
export { requestFamily } from './unified_routes.js';

const INTERNAL_SERVICE_HEADER = 'X-HomePanel-Internal-Service';
const INTERNAL_SERVICE_VALUE = 'homepanel-cloud';
const ADMIN_TOKEN_COOKIE = 'video_scraper_admin_token';

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
    error: 'Video service unavailable',
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

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (requestFamily(pathname) === 'homepanel') {
      return homePanelWorker.fetch(request, env, ctx);
    }

    if (pathname.startsWith('/api/') && pathname !== '/api/health' && !videoApiAuthorized(request, env)) {
      return unauthorizedVideoResponse();
    }

    const videoService = env?.VIDEO_SERVICE;
    if (!videoService || typeof videoService.fetch !== 'function') return unavailableVideoResponse();

    try {
      return await videoService.fetch(internalVideoRequest(request));
    } catch (error) {
      console.error('video-service-request-failed', {
        pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      return unavailableVideoResponse();
    }
  }
};
