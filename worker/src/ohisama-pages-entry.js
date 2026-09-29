import { runOptimizedOhisamaCollectorScheduled } from './ohisama-collector-optimized.js';
import { refreshOptimizedOhisamaReadModel } from './ohisama-read-model-optimized.js';

export async function runOhisamaPagesScheduled(controller, env, ctx, dependencies = {}) {
  const result = await runOptimizedOhisamaCollectorScheduled(controller, env, ctx, dependencies);
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
