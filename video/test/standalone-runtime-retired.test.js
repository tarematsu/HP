import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
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
});
