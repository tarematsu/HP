import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('video workspace is source-only and has no standalone Worker commands', () => {
  assert.equal(pkg.scripts.deploy, undefined);
  assert.equal(pkg.scripts.dev, undefined);
  assert.equal(pkg.scripts['check:bundle'], undefined);
  assert.equal(pkg.scripts['db:migrate:remote'], undefined);
  assert.equal(pkg.scripts['db:migrate:production'], undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.check, 'npm run check:syntax && npm run check:audit');
});

test('standalone Worker configuration and stub are deleted', async () => {
  await assert.rejects(access(new URL('../wrangler.jsonc', import.meta.url)));
  await assert.rejects(access(new URL('../src/retired-entry.js', import.meta.url)));
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
