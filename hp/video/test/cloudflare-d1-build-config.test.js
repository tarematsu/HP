import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(await read('../package.json'));
const cloudWrangler = JSON.parse(await read('../../cloud/wrangler.jsonc'));
const workspace = JSON.parse(await read('../../package.json'));

test('dependency installation is controlled by the HomePanel workspace lockfile', async () => {
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.deepEqual(workspace.workspaces, ['cloud', 'video']);
  await assert.rejects(access(new URL('../wrangler.jsonc', import.meta.url)));

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
});

test('video workspace cannot deploy a standalone Worker', () => {
  assert.equal(packageJson.scripts.deploy, undefined);
  assert.equal(packageJson.scripts.dev, undefined);
  assert.equal(packageJson.scripts['check:bundle'], undefined);
  assert.equal(packageJson.scripts['db:migrate:remote'], undefined);
  assert.equal(packageJson.scripts['db:migrate:production'], undefined);
  assert.equal(packageJson.scripts['db:create'], undefined);
});
