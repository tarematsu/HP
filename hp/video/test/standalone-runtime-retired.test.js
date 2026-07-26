import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('video deployment is explicit and remote database ownership stays in cloud migrations', () => {
  assert.equal(pkg.scripts.deploy, 'wrangler deploy --config wrangler.jsonc --keep-vars');
  assert.equal(pkg.scripts['db:migrate:remote'], undefined);
  assert.equal(pkg.scripts['db:migrate:production'], undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.dev, 'wrangler dev --local');
});

test('private Wrangler config targets only the HomePanel video service', () => {
  assert.equal(wrangler.name, 'homepanel-video');
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(wrangler.queues?.consumers?.[0]?.max_concurrency, 1);
  const database = wrangler.d1_databases?.find((entry) => entry.binding === 'DB');
  assert.equal(database?.database_name, 'homepanel-data');
  assert.match(database?.database_id, /^[0-9a-f-]{36}$/i);
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
