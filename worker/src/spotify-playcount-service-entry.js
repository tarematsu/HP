import app from './spotify-playcount-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';

export const SPOTIFY_PLAYCOUNT_CRON = '0 * * * *';

export default {
  scheduled: app.scheduled,
  queue: app.queue,
  async fetch(request, env) {
    const internal = await handleInternalScheduled(
      request,
      env,
      app.scheduled,
      SPOTIFY_PLAYCOUNT_CRON,
    );
    if (internal) return internal;
    return app.fetch(request, env);
  },
};
