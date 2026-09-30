import app, { NOGIZAKA_CRON, runNogizakaScheduled } from './nogizaka-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';

export default {
  scheduled: app.scheduled,
  queue: app.queue,
  async fetch(request, env, ctx) {
    const internal = await handleInternalScheduled(
      request,
      env,
      runNogizakaScheduled,
      NOGIZAKA_CRON,
    );
    if (internal) return internal;
    return app.fetch(request, env, ctx);
  },
};
