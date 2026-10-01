import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/capture-pages-visual-audit.mjs', import.meta.url), 'utf8');

test('Pages visual audit enumerates only visible dashboard mode tabs', () => {
  assert.match(source, /visible:\s*!button\.hidden[\s\S]*style\.display !== 'none'[\s\S]*style\.visibility !== 'hidden'/);
  assert.match(source, /\.filter\(\(\{ visible \}\) => visible\)/);
  assert.match(source, /No visible navigation tabs were found/);
});
