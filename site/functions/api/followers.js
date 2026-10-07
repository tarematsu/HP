import { proxyPagesReadModel } from '../lib/pages-read-model-service.js';

export function onRequestGet({ env }) {
  return proxyPagesReadModel(env, 'followers', {
    cacheControl: 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
    unavailableMessage: 'followers materialized response unavailable',
    missingBindingMessage: 'followers materialized response unavailable',
  });
}
