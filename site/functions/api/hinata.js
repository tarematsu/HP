import { proxyStationheadMaterializedReadModel } from '../lib/stationhead-materialized-proxy.js';

export function onRequestGet({ env }) {
  return proxyStationheadMaterializedReadModel(env, 'ohisama', {
    unavailableError: 'hinata materialized response unavailable',
    cacheControl: 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
  });
}
