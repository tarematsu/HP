import { apiCacheTtlSeconds } from '../../packages/sh-shared/api-contract.mjs';
import { PAGES_QUERY_MODEL_KEYS } from './pages-query-contract.js';

const loaders = {
  'kkbox': () => import('./pages-query-api-kkbox.js'),
  'qq-music': () => import('./pages-query-api-qq-music.js'),
  'kugou-music': () => import('./pages-query-api-kugou-music.js'),
  'dashboard-details': () => import('./pages-query-api-dashboard-details.js'),
  'spotify-monthly-listeners': () => import('./pages-query-api-spotify-monthly-listeners.js'),
  'host-history': () => import('./pages-query-api-host-history.js'),
  'history': () => import('./pages-query-api-history.js'),
  'sakurazaka46jp': () => import('./pages-query-api-sakurazaka46jp.js'),
  'spotify-playcounts': () => import('./pages-query-api-spotify-playcounts.js'),
  'first-week-comparison': () => import('./pages-query-api-first-week-comparison.js'),
};

export async function runPagesQuery(request, env) {
  const internalUrl = new URL(request.url);
  const key = String(internalUrl.searchParams.get('key') || '').trim();
  if (!PAGES_QUERY_MODEL_KEYS.has(key)) return new Response(null, { status: 404 });
  const route = key.slice('query:'.length);
  const url = new URL(`/api/${route}`, 'https://pages-query.internal');
  for (const [name, value] of internalUrl.searchParams) {
    if (name !== 'key' && name !== 'api' && name !== 'v') url.searchParams.append(name, value);
  }
  const handler = (await loaders[route]()).onRequestGet;
  const response = await handler({ request: new Request(url), env });
  const headers = new Headers(response.headers);
  const policy = headers.get('cache-control') || '';
  if (!response.ok) {
    headers.set('cache-control', 'no-store');
  } else if (/\bpublic\b/i.test(policy) && !/\b(private|no-store|no-cache)\b/i.test(policy)) {
    // The Worker cache must not extend the lifetime Pages previously exposed.
    // Preserve stricter policies and all existing browser/cache directives.
    const cap = apiCacheTtlSeconds({ url: url.href });
    headers.set('cache-control', policy.replace(/\b(s-maxage|max-age)=(\d+)/gi,
      (_, name, value) => `${name}=${Math.min(Number(value), cap)}`));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
