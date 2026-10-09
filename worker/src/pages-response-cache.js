// Reuse the response's declared public lifetime without extending model freshness.
export function pagesResponseCacheKey(url) {
  return new Request(`https://pages-response-cache.internal/v1${url.pathname}${url.search}`);
}

export function cacheablePagesResponse(response, now, maximumAge) {
  if (!response?.ok) return null;
  const policy = response.headers.get('cache-control') || '';
  if (!/(?:^|,)\s*public(?:,|$)/i.test(policy) || /(?:private|no-store|no-cache)/i.test(policy)) return null;
  const ttl = /(?:^|,)\s*s-maxage=(\d+)/i.exec(policy)
    || /(?:^|,)\s*max-age=(\d+)/i.exec(policy);
  if (!ttl || Number(ttl[1]) <= 0) return null;
  const updatedAt = Number(response.headers.get('x-materialized-at'));
  const remaining = response.headers.has('x-materialized-at') && Number.isFinite(updatedAt)
    ? Math.floor((updatedAt + maximumAge - now) / 1000)
    : Number(ttl[1]);
  const seconds = Math.min(Number(ttl[1]), remaining);
  if (seconds <= 0) return null;
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set('cache-control', `public, max-age=${seconds}, s-maxage=${seconds}`);
  return new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
}
