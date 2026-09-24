import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark reuses one dependency object', () => {
  assert.match(source, /const dependencies = \{/);
  assert.match(source, /runPagesResponseFetch\(request, \{\}, dependencies\)/);
});
