// Adapt the existing fixture service to the actual raw R2 storage contract.
export function modelBucket(service) {
  return { async get(key) {
    if (!key.startsWith('pages-response/v1/')) return null;
    const modelKey = decodeURIComponent(key.slice('pages-response/v1/'.length, -5));
    const url = new URL('https://pages-read-model.internal/_internal/pages-response');
    url.searchParams.set('key', modelKey);
    const response = await service.fetch(new Request(url));
    if (!response) return null;
    return { body: response.body, customMetadata: {
      format: 'raw-response-v1', status: String(response.status),
      updated_at: response.headers.get('x-materialized-at') || String(Date.now()),
      headers_json: JSON.stringify(Object.fromEntries(response.headers)),
    } };
  } };
}
