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

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

export function pagesReadModelJson(payload, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': cacheControl },
  });
}

export async function proxyPagesReadModel(
  env,
  modelKey,
  {
    cacheControl,
    unavailableMessage = 'materialized read model unavailable',
    missingBindingMessage = 'PAGES_READ_MODEL_SERVICE binding missing',
    httpErrorPrefix = unavailableMessage,
    coldStartPayload = null,
  } = {},
) {
  if (typeof env?.PAGES_READ_MODEL_SERVICE?.fetch !== 'function') {
    return pagesReadModelJson({ ok: false, error: missingBindingMessage }, 503);
  }

  const response = await fetchPagesReadModel(env, modelKey);
  if (!response) return pagesReadModelJson({ ok: false, error: unavailableMessage }, 503);
  if (response.status === 404 && coldStartPayload) {
    return pagesReadModelJson(coldStartPayload, 200);
  }
  if (!response.ok) {
    return pagesReadModelJson({
      ok: false,
      error: `${httpErrorPrefix} returned HTTP ${response.status || 503}`,
    }, 503);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', JSON_HEADERS['content-type']);
  headers.set('cache-control', cacheControl || 'no-store');
  headers.set('x-content-type-options', JSON_HEADERS['x-content-type-options']);
  headers.set('vary', JSON_HEADERS.vary);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
