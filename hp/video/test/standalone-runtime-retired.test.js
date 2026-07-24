import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const retired = 'node scripts/standalone-runtime-retired.mjs';

test('remote video deployment and migration commands remain disabled', () => {
  for (const name of [
    'config:production',
    'deploy',
    'db:create',
    'db:migrate:remote',
    'db:migrate:production'
  ]) {
    assert.match(pkg.scripts[name], new RegExp(`^${retired.replaceAll('.', '\\.')}`));
  }

  assert.doesNotMatch(pkg.scripts.deploy, /wrangler deploy/);
  assert.doesNotMatch(pkg.scripts['db:migrate:remote'], /wrangler d1/);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.dev, 'wrangler dev --local');
});

test('standalone Wrangler config cannot target retired production resources', () => {
  assert.equal(wrangler.name, 'homepanel-video-local-only');
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.queues, undefined);
  const database = wrangler.d1_databases?.find((entry) => entry.binding === 'DB');
  assert.equal(database?.database_name, 'homepanel-video-local');
  assert.equal(database?.database_id, '00000000-0000-0000-0000-000000000000');
});
