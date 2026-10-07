import { proxyStationheadMaterializedReadModel } from '../lib/stationhead-materialized-proxy.js';

export function onRequestGet({ env }) {
  return proxyStationheadMaterializedReadModel(env, 'buddies', {
    unavailableError: 'dashboard materialized response unavailable',
    cacheControl: 'no-store',
  });
}
