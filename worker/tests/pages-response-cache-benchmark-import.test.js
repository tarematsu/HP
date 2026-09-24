import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/benchmark-pages-response-cache-hit.mjs', import.meta.url), 'utf8');

test('Pages benchmark invokes the production serving entry', () => {
  assert.match(source, /import \{ runPagesResponseFetch \} from '\.\.\/src\/pages-response-fetch-entry\.js'/);
});
