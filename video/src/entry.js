import core from './entry-core.js';

export function migrationFreezeEnabled(env) {
  return String(env?.VIDEO_MIGRATION_FREEZE || '').trim().toLowerCase() === 'true';
}

function frozenApiResponse() {
  return Response.json({
    ok: false,
    error: 'Video data migration is in progress',
    retryable: true
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': '300'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    if (migrationFreezeEnabled(env) && new URL(request.url).pathname.startsWith('/api/')) {
      return frozenApiResponse();
    }
    return core.fetch(request, env, ctx);
  },

  async queue(batch, env, ctx) {
    if (migrationFreezeEnabled(env)) {
      console.log('video-migration-freeze-queue-skipped', { messages: batch?.messages?.length || 0 });
      return undefined;
    }
    return core.queue(batch, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (migrationFreezeEnabled(env)) {
      console.log('video-migration-freeze-scheduled-skipped', { cron: controller?.cron || '' });
      return undefined;
    }
    return core.scheduled(controller, env, ctx);
  }
};
