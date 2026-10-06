import { formatNogizakaBroadcastContent } from '../../../packages/sh-shared/index.mjs';
export { formatNogizakaBroadcastContent };

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, max-age=10, stale-while-revalidate=10',
};
const INTERNAL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=nogizaka-listening-party';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: status === 200 ? JSON_HEADERS : { ...JSON_HEADERS, 'cache-control': 'no-store' },
});

function unavailable(status = 503) {
  return json({
    ok: false,
    error: 'nogizaka46smej listening-party read model unavailable',
  }, status);
}

export async function onRequestGet({ env }) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable();

  let response;
  try {
    response = await service.fetch(new Request(INTERNAL_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return unavailable();
  }
  if (!response?.ok) return unavailable(response?.status === 404 ? 503 : response?.status || 503);

  const headers = new Headers(response.headers);
  headers.set('cache-control', JSON_HEADERS['cache-control']);
  headers.set('content-type', JSON_HEADERS['content-type']);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
