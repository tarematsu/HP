import { fetchPagesReadModel, pagesReadModelJson } from './pages-read-model-service.js';

// The Worker owns validation, data loading and response assembly. Pages streams
// the response and never retries with a local database or JSON transformation.
export async function proxyPagesQuery({ request, env }, route) {
  const params = new URL(request.url).searchParams;
  return await fetchPagesReadModel(env, `query:${route}`, { params })
    || pagesReadModelJson({ ok: false, error: 'Worker query service unavailable' }, 503);
}
