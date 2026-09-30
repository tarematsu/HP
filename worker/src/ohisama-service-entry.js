import app, { runOhisamaPagesScheduled } from './ohisama-pages-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import { OHISAMA_COLLECTOR_CRON } from './ohisama-collector-optimized.js';

export default {
  scheduled: app.scheduled,
  async fetch(request, env) {
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
