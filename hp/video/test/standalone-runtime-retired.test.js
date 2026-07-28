import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const retiredEntry = await readFile(new URL('../src/retired-entry.js', import.meta.url), 'utf8');

test('video workspace deploys a rollback-safe retired stub', () => {
  assert.equal(pkg.scripts.deploy, 'wrangler deploy --config wrangler.jsonc --keep-vars');
  assert.equal(pkg.scripts['db:migrate:remote'], undefined);
  assert.equal(pkg.scripts['db:migrate:production'], undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.dev, 'wrangler dev --local');
  assert.match(retiredEntry, /status: 410/);
  assert.match(retiredEntry, /integrated into homepanel-cloud/);
});

test('retired Wrangler config has no production resource bindings', () => {
  assert.equal(wrangler.name, 'homepanel-video');
  assert.equal(wrangler.main, 'src/retired-entry.js');
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.deepEqual(wrangler.triggers?.crons, []);
  assert.equal(wrangler.assets, undefined);
  assert.equal(wrangler.browser, undefined);
  assert.equal(wrangler.queues, undefined);
  assert.equal(wrangler.d1_databases, undefined);
  assert.equal(wrangler.durable_objects, undefined);
});

test('retired standalone configuration tools stay removed', async () => {
  for (const path of [
    '../run-config.ps1',
    '../scripts/apply-pages-vars.mjs',
    '../scripts/check.mjs',
    '../scripts/cloudflare-d1.mjs',
    '../scripts/configure-cloudflare-pages.mjs',
    '../scripts/prepare-wrangler-config.mjs',
    '../scripts/render-production-config.mjs',
    '../scripts/sync-d1-database-id.mjs',
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)), path);
  }
});
