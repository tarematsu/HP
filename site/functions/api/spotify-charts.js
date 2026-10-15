import { materializedApiKey } from '../../../packages/sh-shared/api-contract.mjs';
import { proxyPagesReadModel, pagesReadModelJson } from '../lib/pages-read-model-service.js';

export function onRequestGet({ request, env }) {
  const key = materializedApiKey(new URL(request.url));
  if (!key) return pagesReadModelJson({ ok: false, error: 'Invalid Spotify chart/year' }, 400);
  return proxyPagesReadModel(env, key, { cacheControl: 'public, max-age=30, s-maxage=300' });
}
