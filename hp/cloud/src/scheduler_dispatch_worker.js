const HOURLY_CRON = '0 * * * *';

const DISPATCHES = Object.freeze([
  Object.freeze({
    binding: 'SCHEDULER_COORDINATOR',
    objectName: 'global',
    url: 'https://scheduler.internal/ensure',
  }),
  Object.freeze({
    binding: 'VIDEO_FEED_COORDINATOR',
    objectName: 'video-liveness',
    url: 'https://homepanel.internal/video-liveness-run',
  }),
  Object.freeze({
    binding: 'VIDEO_FEED_COORDINATOR',
    objectName: 'tver-feed-refresh',
    url: 'https://homepanel.internal/tver-feed-refresh-run',
  }),
]);

async function dispatch(env, target) {
  const namespace = env?.[target.binding];
  if (!namespace?.getByName) {
    throw new Error(`${target.binding} binding unavailable`);
  }
  const response = await namespace.getByName(target.objectName).fetch(target.url, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`${target.objectName} dispatcher returned HTTP ${response.status}`);
  }
  try {
    await response.body?.cancel();
  } catch {
  }
}

export async function runHourlyDispatch(env) {
  await Promise.all(DISPATCHES.map((target) => dispatch(env, target)));
}

export default {
  scheduled(controller, env, ctx) {
    if (controller?.cron !== HOURLY_CRON) return;
    const work = runHourlyDispatch(env).catch((error) => {
      console.error('homepanel-hourly-dispatch-failed', {
        error: String(error?.message || error).slice(0, 300),
      });
      throw error;
    });
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else return work;
  },
};

export { HOURLY_CRON };
