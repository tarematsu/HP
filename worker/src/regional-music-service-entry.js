import app, { YOUTUBE_MUSIC_DAILY_CRON } from './regional-music-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';

export default {
  scheduled: app.scheduled,
  queue: app.queue,
  async fetch(request, env) {
    const internal = await handleInternalScheduled(
      request,
      env,
      app.scheduled,
      YOUTUBE_MUSIC_DAILY_CRON,
      [YOUTUBE_MUSIC_DAILY_CRON],
    );
    if (internal) return internal;
    return new Response('Not found', { status: 404 });
  },
};
