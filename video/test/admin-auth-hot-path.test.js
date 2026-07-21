import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('admin authentication avoids repeated string and cookie-array allocation', () => {
  assert.match(source, /let cachedBearerAuthorization = '';/);
  assert.match(source, /source !== cachedAdminTokenSource/);
  assert.match(source, /ADMIN_TOKEN_COOKIE_PREFIX/);
  assert.match(source, /header\.indexOf\(';',/);
  assert.doesNotMatch(source, /header\.split\(';'/);
  assert.doesNotMatch(source, /`Bearer \$\{token\}`/);
});
