import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { materializeDependencies } from '../src/ingest-channel-optimized-entry.js';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
}

test('CPU budget keeps the 10 ms ceiling with current-version fail-closed coverage', () => {
  const source = readFileSync(
    new URL('../../.github/scripts/audit-cloudflare-telemetry.py', import.meta.url),
    'utf8',
  );
  const router = readFileSync(new URL('../src/minute-derive-router.js', import.meta.url), 'utf8');
  assert.match(source, /STATELESS_CPU_BUDGET_MS = float\(os\.environ\.get\("CPU_BUDGET_MS", "10"\)\)/);
  assert.match(source, /DURABLE_OBJECT_CPU_BUDGET_MS/);
  assert.match(source, /EXEMPT_MARKERS/);
  assert.match(source, /terminal_cpu = cpu_limit_outcome\(event\)/);
  assert.match(source, /numeric_overage = cpu_ms is not None and cpu_ms > item\["budget_ms"\]/);
  assert.match(source, /missing = \[worker for worker, values in samples\.items\(\) if not values\]/);
  assert.match(source, /not truncated and not missing/);
  assert.match(source, /current_events/);
  assert.match(router, /const LIVE_WRITE_STAGE = 'live-write'/);
  assert.match(router, /processSparseLiveStart/);
  assert.match(router, /processSparseLiveWrite/);
});

test('production core Worker bounds comment work and defers duplicate metadata persistence', async () => {
  const runtime = config('wrangler.runtime.jsonc');
  const entry = readFileSync(new URL('../src/ingest-channel-optimized-entry.js', import.meta.url), 'utf8');
  assert.equal(runtime.vars.CHAT_LIMIT, 0);
  assert.equal(runtime.vars.COMMENT_CHAIN_MAX_ATTEMPTS, 1);
  assert.match(entry, /CHAT_LIMIT: \{ value: 25/);
  assert.equal(runtime.vars.METADATA_REFRESH_INTERVAL_MS, 1_800_000);
  assert.equal(runtime.vars.COLLECTED_METADATA_PERSIST_ENABLED, false);
  assert.equal(await materializeDependencies({}).collectedMetadataDue(), false);
});

test('retired runtime adapters and compatibility schedulers are physically absent', () => {
  for (const path of [
    '../../site/functions/lib/apple-music-d1-pruner.js',
    '../src/other-entry.js',
    '../src/other-entry-compat.js',
    '../src/other-monitor-support.js',
    '../src/other-monitor-entry.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});
