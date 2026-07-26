import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('../package.json'));
const wrangler = JSON.parse(read('../wrangler.jsonc'));
const workspace = JSON.parse(read('../../package.json'));


test('dependency installation is controlled by the HomePanel workspace lockfile', () => {
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.deepEqual(workspace.workspaces, ['cloud', 'video']);
  assert.equal(wrangler.name, 'homepanel-video');
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);

  const database = wrangler.d1_databases?.find((entry) => entry?.binding === 'DB');
  assert.equal(database?.database_name, 'homepanel-data');
  assert.match(database?.database_id, /^[0-9a-f-]{36}$/i);
});

test('private video configuration owns its bounded Queue consumer', () => {
  assert.deepEqual(wrangler.queues?.producers, [{
    binding: 'MANUAL_IMPORT_QUEUE',
    queue: 'videoscraper-manual-imports'
  }]);
  assert.equal(wrangler.queues?.consumers?.[0]?.max_batch_size, 1);
  assert.equal(wrangler.queues?.consumers?.[0]?.max_concurrency, 1);
  assert.equal(wrangler.queues?.consumers?.[0]?.dead_letter_queue, 'videoscraper-manual-imports-dlq');
});

test('production operations target only the private video Worker', () => {
  assert.equal(packageJson.scripts.deploy, 'wrangler deploy --config wrangler.jsonc --keep-vars');
  assert.equal(packageJson.scripts['db:migrate:remote'], undefined);
  assert.equal(packageJson.scripts['db:migrate:production'], undefined);
  assert.equal(packageJson.scripts['db:create'], undefined);
});
