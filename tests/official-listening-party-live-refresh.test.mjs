import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('official listening party live refresh uses uncached status samples every 15 seconds', () => {
  const status = readFileSync(new URL('../site/functions/api/sakurazaka46jp-status.js', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../site/public/history/history-broadcast-summary.js', import.meta.url), 'utf8');

  assert.match(status, /cache-control': 'no-store'/);
  assert.match(summary, /LIVE_REFRESH_MS = 15_000/);
  assert.match(summary, /\/api\/sakurazaka46jp-status/);
  assert.match(summary, /mergeLiveSeries/);
  assert.match(summary, /SERIES_CACHE_PREFIX = 'sakurazaka46jp:v1:'/);
  assert.match(summary, /document\.getElementById\('load'\)\?\.click\(\)/);
});
