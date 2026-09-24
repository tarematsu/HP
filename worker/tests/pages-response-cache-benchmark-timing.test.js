import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark uses high-resolution performance timing', () => {
  assert.match(source, /import \{ performance \} from 'node:perf_hooks'/);
  assert.equal((source.match(/performance\.now\(\)/g) || []).length, 2);
});
