import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

test('Pages static JS/CSS use Cloudflare default revalidation instead of long-lived custom caching', () => {
  assert.doesNotMatch(headers, /^\/\*\.js\s*$/m);
  assert.doesNotMatch(headers, /^\/\*\.css\s*$/m);
  assert.doesNotMatch(headers, /stale-while-revalidate/);
  assert.match(headers, /^\/index\.html\s*\n\s+Cache-Control: no-store, max-age=0, must-revalidate$/m);
});
