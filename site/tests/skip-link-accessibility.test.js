import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const baseCss = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');
const fixesCss = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');

test('skip link remains available to visible keyboard focus', () => {
  assert.match(baseCss, /\.skip-link\s*\{[\s\S]*translateY\(-150%\)/);
  assert.match(baseCss, /\.skip-link:focus\s*\{\s*transform:\s*none/);
});

test('direct hash navigation focus does not expose the skip link', () => {
  assert.match(fixesCss, /\.skip-link:focus:not\(:focus-visible\)\s*\{[\s\S]*translateY\(-150%\)/);
});
