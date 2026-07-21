import homePanelWorker from './worker_entry.ts';
import videoWorker from '../../video/src/entry.js';
import { requestFamily } from './unified_routes.js';
import {
  inactiveVideoRuntimeResponse,
  videoRuntimeActive
} from './video_runtime_activation.js';

export { SchedulerCoordinator } from './worker_entry.ts';
export { requestFamily } from './unified_routes.js';

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (requestFamily(pathname) === 'homepanel') {
      return homePanelWorker.fetch(request, env, ctx);
    }
    if (!await videoRuntimeActive(env)) return inactiveVideoRuntimeResponse();
    return videoWorker.fetch(request, env, ctx);
  },

  async queue(batch, env, ctx) {
    if (!await videoRuntimeActive(env)) {
      console.log('video-runtime-inactive-queue-skipped', {
        messages: batch?.messages?.length || 0
      });
      return undefined;
    }
    if (typeof videoWorker.queue !== 'function') return undefined;
    return videoWorker.queue(batch, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (!await videoRuntimeActive(env)) {
      console.log('video-runtime-inactive-scheduled-skipped', {
        cron: controller?.cron || ''
      });
      return undefined;
    }
    if (typeof videoWorker.scheduled !== 'function') return undefined;
    return videoWorker.scheduled(controller, env, ctx);
  }
};
