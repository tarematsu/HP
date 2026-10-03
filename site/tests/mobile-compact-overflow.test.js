import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const baseCss = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');

test('320px viewport is not widened by a body min-width', () => {
  assert.match(baseCss, /body\s*\{[^}]*min-width:\s*0\s*;/s);
  assert.doesNotMatch(baseCss, /body\s*\{[^}]*min-width:\s*320px\s*;/s);
});
