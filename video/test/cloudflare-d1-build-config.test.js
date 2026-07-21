import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('../package.json'));
const wrangler = JSON.parse(read('../wrangler.jsonc'));

test('dependency installation does not resolve or rewrite a production D1 binding', () => {
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.equal(wrangler.name, 'homepanel-video-local-only');
  assert.equal(wrangler.workers_dev, false);

  const database = wrangler.d1_databases?.find((entry) => entry?.binding === 'DB');
  assert.equal(database?.database_name, 'homepanel-video-local');
  assert.equal(database?.database_id, '00000000-0000-0000-0000-000000000000');
});

test('standalone configuration has no production Queue bindings', () => {
  assert.equal(wrangler.queues, undefined);
});

test('production operations remain routed through the unified cloud workspace', () => {
  for (const command of [
    'config:production',
    'deploy',
    'db:create',
    'db:migrate:remote',
    'db:migrate:production'
  ]) {
    assert.match(packageJson.scripts[command], /standalone-runtime-retired\.mjs/);
  }
});
