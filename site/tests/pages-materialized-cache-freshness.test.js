import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

test('materialized public cache is bounded to one minute and uses a deployment namespace', () => {
  assert.match(middleware, /MATERIALIZED_EDGE_TTL_MAX_SECONDS = 60/);
  assert.match(middleware, /MATERIALIZED_CACHE_NAMESPACE/);
  assert.match(middleware, /__materialized_cache_rev/);
  assert.match(middleware, /Math\.min\(requestedTtl, materializedTtl, remainingSeconds\)/);
});
