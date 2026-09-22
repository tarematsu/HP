import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const middleware = readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

test('dashboard retries transient materialized read-model outages without live D1 fallback', () => {
  assert.match(fetchCache, /const TRANSIENT_DASHBOARD_STATUSES = new Set\(\[502, 503, 504\]\)/);
  assert.match(fetchCache, /const DASHBOARD_RETRY_DELAYS_MS = Object\.freeze\(\[500, 1500, 3000\]\)/);
  assert.match(fetchCache, /async function fetchDashboardWithRetry/);
  assert.match(fetchCache, /await waitForRetry\(delayMs, init\?\.signal\)/);
  assert.match(fetchCache, /if \(payload\?\.ok\) \{[\s\S]*clearTransientStatus\(\);[\s\S]*dispatchPayload\(payload, 'network'\);/);
  assert.match(middleware, /const LIVE_PAGES_FALLBACK_MODEL_KEYS = new Set\(\)/);
});
