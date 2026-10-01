import { runOptimizedOhisamaCollectorScheduled } from './ohisama-collector-optimized.js';
import { registerOhisamaFollowerTarget } from './ohisama-collector-entry.js';
import { refreshOptimizedOhisamaReadModel } from './ohisama-read-model-optimized.js';

export function activeBroadcastFollowerRegistrar(registerFollowerTarget) {
  if (typeof registerFollowerTarget !== 'function') {
    throw new TypeError('registerFollowerTarget must be a function');
  }
  return async (env, snapshot, observedAt) => {
    if (snapshot?.is_broadcasting !== 1) return false;
    return registerFollowerTarget(env, snapshot, observedAt);
  };
}

export async function runOhisamaPagesScheduled(controller, env, ctx, dependencies = {}) {
  const registerFollowerTarget = activeBroadcastFollowerRegistrar(
    dependencies.registerFollowerTarget || registerOhisamaFollowerTarget,
  );
  const result = await runOptimizedOhisamaCollectorScheduled(
    controller,
    env,
    ctx,
    { ...dependencies, registerFollowerTarget },
  );
  if (!result?.collected) return result;

  try {
    const readModel = await refreshOptimizedOhisamaReadModel(env, result, result.observed_at);
    console.log(JSON.stringify({
      event: 'ohisama_pages_read_model_published',
      ...readModel,
    }));
    return { ...result, read_model: readModel };
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    console.error(JSON.stringify({
      event: 'ohisama_pages_read_model_failed',
      observed_at: result.observed_at,
      error: detail,
    }));
    return {
      ...result,
      read_model: { published: false, error: detail },
    };
  }
}

export default {
  scheduled: runOhisamaPagesScheduled,
};
