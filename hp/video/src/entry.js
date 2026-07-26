import core from './entry-core.js';

export { VideoFeedCoordinator } from './video-feed-coordinator.js';

const INTERNAL_HEADER = 'X-HomePanel-Internal-Service';
const INTERNAL_VALUE = 'homepanel-cloud';

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

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/health') return healthResponse(env);
    if (request.headers.get(INTERNAL_HEADER) !== INTERNAL_VALUE) {
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const headers = new Headers(request.headers);
    headers.delete(INTERNAL_HEADER);
    return core.fetch(
      new Request(request, { headers }),
      { ...env, INTERNAL_SERVICE_AUTHENTICATED: true },
      ctx
    );
  },

  queue(batch, env, ctx) {
    return core.queue(batch, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return core.scheduled(controller, env, ctx);
  }
};
