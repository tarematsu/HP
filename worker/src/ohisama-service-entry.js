import app, { runOhisamaPagesScheduled } from './ohisama-pages-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import { OHISAMA_COLLECTOR_CRON, readOhisamaCollectorHealth } from './ohisama-collector-optimized.js';

export default {
  scheduled: app.scheduled,
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      const operational = await readOhisamaCollectorHealth(env);
      return Response.json({
        ok: operational.status === 'ok',
        worker: 'sh-ohisama-collector',
        operational,
      }, {
        status: operational.status === 'ok' ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      });
    }
    const internal = await handleInternalScheduled(
      request,
      env,
      runOhisamaPagesScheduled,
      OHISAMA_COLLECTOR_CRON,
    );
    if (internal) return internal;
    return new Response('Not found', { status: 404 });
  },
};
