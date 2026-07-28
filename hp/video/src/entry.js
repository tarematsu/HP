import core from './entry-core.js';
import { LIVENESS_CRON } from './liveness-schedule.js';

export { VideoFeedCoordinator } from './video-feed-coordinator.js';

const INTERNAL_HEADER = 'X-HomePanel-Internal-Service';
const INTERNAL_VALUE = 'homepanel-cloud';
const LIVENESS_COORDINATOR_NAME = 'video-liveness';
const LIVENESS_COORDINATOR_URL = 'https://homepanel.internal/video-liveness-run';

async function healthResponse(env) {
  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first();
    const ok = Number(row?.ok) === 1;
    return Response.json({
      ok,
      service: 'homepanel-video',
      checkedAt: new Date().toISOString()
    }, {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      service: 'homepanel-video',
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      checkedAt: new Date().toISOString()
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}

async function dispatchLiveness(env) {
  const response = await env.SCHEDULER_COORDINATOR
    .getByName(LIVENESS_COORDINATOR_NAME)
    .fetch(LIVENESS_COORDINATOR_URL, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`video liveness coordinator returned ${response.status}`);
  }
  return response.json();
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/health') return healthResponse(env);
    if (request.headers.get(INTERNAL_HEADER) !== INTERNAL_VALUE) {
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const headers = new Headers(request.headers);
    headers.delete(INTERNAL_HEADER);
    headers.set('Authorization', `Bearer ${INTERNAL_VALUE}`);
    return core.fetch(
      new Request(request, { headers }),
      { ...env, ADMIN_TOKEN: INTERNAL_VALUE },
      ctx
    );
  },

  queue(batch, env, ctx) {
    return core.queue(batch, env, ctx);
  },

  scheduled(controller, env, ctx) {
    if (controller.cron !== LIVENESS_CRON) return core.scheduled(controller, env, ctx);
    ctx.waitUntil(
      dispatchLiveness(env).catch((error) => {
        console.error('scheduled-video-liveness-dispatch-failed', {
          cron: controller.cron,
          error: String(error?.message || error)
        });
        throw error;
      })
    );
  }
};
