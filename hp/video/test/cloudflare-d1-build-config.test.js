import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('../package.json'));
const retiredWrangler = JSON.parse(read('../wrangler.jsonc'));
const cloudWrangler = JSON.parse(read('../../cloud/wrangler.jsonc'));
const workspace = JSON.parse(read('../../package.json'));

test('dependency installation is controlled by the HomePanel workspace lockfile', () => {
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.deepEqual(workspace.workspaces, ['cloud', 'video']);
  assert.equal(retiredWrangler.name, 'homepanel-video');
  assert.equal(retiredWrangler.main, 'src/retired-entry.js');
  assert.equal(retiredWrangler.workers_dev, false);
  assert.equal(retiredWrangler.preview_urls, false);
  assert.equal(retiredWrangler.d1_databases, undefined);

  const database = cloudWrangler.d1_databases?.find((entry) => entry?.binding === 'DB');
  assert.equal(database?.database_name, 'homepanel-data');
  assert.match(database?.database_id, /^[0-9a-f-]{36}$/i);
});

test('unified cloud configuration owns the bounded Queue consumer', () => {
  assert.deepEqual(cloudWrangler.queues?.producers, [{
    binding: 'MANUAL_IMPORT_QUEUE',
    queue: 'videoscraper-manual-imports'
  }]);
  assert.equal(cloudWrangler.queues?.consumers?.[0]?.max_batch_size, 1);
  assert.equal(cloudWrangler.queues?.consumers?.[0]?.max_concurrency, 1);
  assert.equal(cloudWrangler.queues?.consumers?.[0]?.dead_letter_queue, 'videoscraper-manual-imports-dlq');
  assert.equal(retiredWrangler.queues, undefined);
});

test('video workspace deploys only the rollback-safe retired stub', () => {
  assert.equal(packageJson.scripts.deploy, 'wrangler deploy --config wrangler.jsonc --keep-vars');
  assert.equal(packageJson.scripts['db:migrate:remote'], undefined);
  assert.equal(packageJson.scripts['db:migrate:production'], undefined);
  assert.equal(packageJson.scripts['db:create'], undefined);
});
