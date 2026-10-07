const INTERNAL_PAGES_READ_MODEL_URL = 'https://pages-read-model.internal/_internal/pages-response';

export async function fetchPagesReadModel(env, modelKey) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function' || !modelKey) return null;
  const url = new URL(INTERNAL_PAGES_READ_MODEL_URL);
  url.searchParams.set('key', modelKey);
  try {
    return await service.fetch(new Request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return null;
  }
}
