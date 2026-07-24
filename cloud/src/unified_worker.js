import homePanelWorker from './worker_entry.ts';
import videoWorker from '../../video/src/entry.js';
import { registerRuntimeEnv } from '../../video/src/runtime-env.js';
import { requestFamily } from './unified_routes.js';
import { queueSchedulerWatchdog } from './scheduler_coordinator.ts';
import {
  inactiveVideoRuntimeResponse,
  retryInactiveVideoBatch,
  videoRuntimeActive
} from './video_runtime_activation.js';

export { SchedulerCoordinator } from './worker_entry.ts';
export { requestFamily } from './unified_routes.js';

export default {
  async fetch(request, env, ctx) {
    registerRuntimeEnv(env);
    const pathname = new URL(request.url).pathname;
    if (requestFamily(pathname) === 'homepanel') {
      return homePanelWorker.fetch(request, env, ctx);
    }
    if (!await videoRuntimeActive(env)) return inactiveVideoRuntimeResponse();
    return videoWorker.fetch(request, env, ctx);
  },

  async queue(batch, env, ctx) {
    registerRuntimeEnv(env);
    if (!await videoRuntimeActive(env)) {
      retryInactiveVideoBatch(batch);
      return undefined;
    }
    if (typeof videoWorker.queue !== 'function') return undefined;
    return videoWorker.queue(batch, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    registerRuntimeEnv(env);
    queueSchedulerWatchdog(env, ctx);
  }
};
