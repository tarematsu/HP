import { proxyPagesQuery } from '../lib/pages-query-proxy.js';

export function onRequestGet(context) {
  return proxyPagesQuery(context, 'dashboard-details');
}
