import { formatNogizakaBroadcastContent } from '../../../packages/sh-shared/index.mjs';
import { proxyStationheadMaterializedReadModel } from '../lib/stationhead-materialized-proxy.js';

export { formatNogizakaBroadcastContent };

export function onRequestGet({ env }) {
  return proxyStationheadMaterializedReadModel(env, 'nogizaka', {
    unavailableError: 'nogizaka46smej listening-party read model unavailable',
    cacheControl: 'private, max-age=10, stale-while-revalidate=10',
  });
}
