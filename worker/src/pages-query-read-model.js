import { loadMaterializedResponse } from './pages-response-store.js';
import { modelMaximumAge, materializedStaleMaximumAge } from './pages-response-models.js';

// Called only inside the DO query processor; never recurse through HTTP/service bindings.
export async function fetchPagesReadModel(env, modelKey) {
  const now = Date.now();
  try {
    return await loadMaterializedResponse(env?.PAGES_RESPONSE_R2, modelKey, now,
      materializedStaleMaximumAge(env, modelMaximumAge(modelKey, env)));
  } catch {
    return null;
  }
}
