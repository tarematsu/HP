import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

test('materialized shared HTTP cache is bounded without a Cache API namespace', () => {
  assert.match(middleware, /MATERIALIZED_EDGE_TTL_MAX_SECONDS = 60/);
  assert.match(middleware, /DASHBOARD_EDGE_TTL_MAX_SECONDS = 15/);
  assert.match(middleware, /Math\.min\(requestedTtl, edgeMaximum, cadenceSeconds, remainingSeconds\)/);
  assert.match(middleware, /headers\.set\('x-edge-cache', 'HTTP'\)/);
  assert.doesNotMatch(middleware, /MATERIALIZED_CACHE_NAMESPACE|__materialized_cache_rev|caches\.default|cache\.put/);
});
