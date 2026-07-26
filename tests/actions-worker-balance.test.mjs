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

test('frequent Worker maintenance Actions reuse one dependency cache contract', () => {
  for (const path of scheduledWorkerActions) {
    const workflow = read(path);
    assert.match(workflow, /uses: actions\/cache@v4/, path);
    assert.match(workflow, /path: worker\/node_modules/, path);
    assert.match(
      workflow,
      /key: \$\{\{ runner\.os \}\}-node22-worker-actions-\$\{\{ hashFiles\('worker\/package-lock\.json', 'packages\/sh-shared\/\*\*'\) \}\}/,
      path,
    );
    assert.match(workflow, /if: steps\.worker-modules\.outputs\.cache-hit != 'true'/, path);
    assert.match(workflow, /npm ci --no-audit --no-fund/, path);
  }
});

test('incremental minute rebuild never cancels a partially committed upload', () => {
  const workflow = read('.github/workflows/run-local-minute-facts-rebuild.yml');
  assert.match(workflow, /group: minute-facts-local-rebuild/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /Never cancel an upload that may already have committed part of its window/);
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
