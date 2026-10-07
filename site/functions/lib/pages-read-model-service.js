const INTERNAL_PAGES_READ_MODEL_URL = 'https://pages-read-model.internal/_internal/pages-response';

function appendPublicParams(url, params) {
  if (!params) return;
  const entries = params instanceof URLSearchParams
    ? params.entries()
    : new URLSearchParams(params).entries();
  for (const [name, value] of entries) {
    if (name === 'v' || name === 'key' || name === 'api') continue;
    url.searchParams.append(name, value);
  }
}

export function pagesReadModelUrl(modelKey, { api = false, params = null } = {}) {
  if (!modelKey) return null;
  const url = new URL(INTERNAL_PAGES_READ_MODEL_URL);
  url.searchParams.set('key', modelKey);
  if (api) url.searchParams.set('api', '1');
  appendPublicParams(url, params);
  return url;
}

export async function fetchPagesReadModel(env, modelKey, options = {}) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  const url = pagesReadModelUrl(modelKey, options);
  if (typeof service?.fetch !== 'function' || !url) return null;
  try {
    return await service.fetch(new Request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return null;
  }
}
