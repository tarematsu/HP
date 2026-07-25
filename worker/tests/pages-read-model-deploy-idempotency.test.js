import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../scripts/deploy-runtime.mjs', import.meta.url),
  'utf8',
);
const workerApi = readFileSync(
  new URL('../scripts/cloudflare-workers.mjs', import.meta.url),
  'utf8',
);

test('read-model cutover rollback preserves pre-existing runtime consumers', () => {
  assert.match(source, /runtimeConsumers = new Set/);
  assert.match(source, /if \(!runtimeConsumers\.has\(migration\.queue\)/);
  assert.match(source, /restoreConsumer\(migration\)/);
  assert.match(source, /stationhead-pages-read-model-publication/);
  assert.match(source, /stationhead-read-model/);
  assert.doesNotMatch(source, /capture: true, allowFailure: true/);
  assert.equal(existsSync(new URL('../scripts/deploy-pages-read-model.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../scripts/deploy-minute-enrichment.mjs', import.meta.url)), false);
});

test('read-model retirement API calls have a bounded timeout', () => {
  assert.match(workerApi, /AbortSignal\.timeout\(20_000\)/);
});

test('Pages KV deployment is validated against the strict 10 ms CPU contract', () => {
  const audit = readFileSync(
    new URL('../../.github/scripts/audit-cloudflare-telemetry.py', import.meta.url),
    'utf8',
  );
  assert.match(audit, /STATELESS_CPU_BUDGET_MS = float\(os\.environ\.get\("CPU_BUDGET_MS", "10"\)\)/);
  assert.match(audit, /terminal_cpu = cpu_limit_outcome\(event\)/);
  assert.match(audit, /numeric_overage = cpu_ms is not None and cpu_ms > item\["budget_ms"\]/);
  assert.match(audit, /not truncated and not missing/);
});
