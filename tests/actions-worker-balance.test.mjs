import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const scheduledWorkerActions = [
  '.github/workflows/run-runtime-offline-maintenance.yml',
  '.github/workflows/run-track-metadata-repair.yml',
  '.github/workflows/run-pages-read-model-rebuild.yml',
];

function assertVerifiedNpmCache(workflow, path) {
  assert.match(workflow, /uses: actions\/setup-node@v4/, path);
  assert.match(workflow, /cache: npm/, path);
  assert.match(workflow, /cache-dependency-path: worker\/package-lock\.json/, path);
  assert.match(workflow, /npm ci --prefer-offline --no-audit --no-fund/, path);
  assert.doesNotMatch(workflow, /uses: actions\/cache@v4/, path);
  assert.doesNotMatch(workflow, /path: worker\/node_modules/, path);
  assert.doesNotMatch(workflow, /outputs\.cache-hit/, path);
}

test('frequent Worker maintenance Actions verify dependencies against the lockfile', () => {
  for (const path of scheduledWorkerActions) {
    assertVerifiedNpmCache(read(path), path);
  }
});

test('incremental minute rebuild never cancels a partially committed upload', () => {
  const workflow = read('.github/workflows/run-local-minute-facts-rebuild.yml');
  assert.match(workflow, /group: minute-facts-local-rebuild/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /Never cancel an upload that may already have committed part of its window/);
});

test('minute rebuild keeps package-manager caching without restoring node_modules', () => {
  const database = read('.github/workflows/database.yml');
  const rebuild = database.match(
    /  minute-facts-local-rebuild:([\s\S]*?)\n  payload-purge:/,
  )?.[1] || '';
  assert.match(rebuild, /uses: actions\/setup-node@v4/);
  assert.match(rebuild, /cache: npm/);
  assert.match(rebuild, /cache-dependency-path: worker\/package-lock\.json/);
  assert.match(rebuild, /npm ci --no-audit --no-fund/);
  assert.doesNotMatch(rebuild, /uses: actions\/cache@v4/);
  assert.doesNotMatch(rebuild, /worker\/node_modules/);
});

test('runtime keeps the retired ordered lane drain-only until production backlog is verified empty', () => {
  const runtime = JSON.parse(read('worker/wrangler.runtime.jsonc'));
  const ordered = runtime.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  );
  assert.equal(ordered.max_batch_size, 1);
  assert.equal(ordered.max_concurrency, 1);
  assert.equal(
    runtime.queues.producers.some(({ binding }) => binding === 'MINUTE_DERIVE_QUEUE'),
    false,
  );
});
