import { REGIONAL_MUSIC_DAILY_SERVICES } from './regional-music-dispatch-plan.js';

export default {
  async fetch(_request, env) {
    if (!env?.REGIONAL_MUSIC_QUEUE?.sendBatch) {
      return Response.json({ ok: false, error: 'REGIONAL_MUSIC_QUEUE binding is missing' }, { status: 500 });
    }

    const startedAt = Date.now();
    const messages = REGIONAL_MUSIC_DAILY_SERVICES.map((service, index) => ({
      body: {
        message_type: 'regional-music-collect',
        service,
        scheduled_at: startedAt + index * 60_000,
      },
      delaySeconds: index * 60,
    }));
    messages.push({
      body: {
        message_type: 'regional-music-publish',
        scheduled_at: startedAt + 30 * 60_000,
      },
      delaySeconds: 30 * 60,
    });

    const result = await env.REGIONAL_MUSIC_QUEUE.sendBatch(messages);
    return Response.json({
      ok: true,
      queued: REGIONAL_MUSIC_DAILY_SERVICES.length,
      first_service: REGIONAL_MUSIC_DAILY_SERVICES[0],
      last_service: REGIONAL_MUSIC_DAILY_SERVICES.at(-1),
      publish_delay_seconds: 30 * 60,
      started_at: startedAt,
      result,
    });
  },
};
