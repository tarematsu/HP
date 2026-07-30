import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const baseCss = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');
const fixesCss = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');
const headerRuntime = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');

test('skip link remains present in the keyboard focus order', () => {
  assert.match(baseCss, /\.skip-link\s*\{[\s\S]*translateY\(-150%\)/);
  assert.match(baseCss, /\.skip-link:focus\s*\{\s*transform:\s*none/);
});

test('programmatic focus stays hidden until a Tab key establishes keyboard modality', () => {
  assert.match(fixesCss, /\.skip-link:focus\s*\{[\s\S]*opacity:\s*0[\s\S]*pointer-events:\s*none/);
  assert.match(fixesCss, /html\.keyboard-navigation \.skip-link:focus\s*\{[\s\S]*opacity:\s*1[\s\S]*transform:\s*none/);
  assert.match(headerRuntime, /event\.key === 'Tab'/);
  assert.match(headerRuntime, /classList\.add\(KEYBOARD_NAVIGATION_CLASS\)/);
  assert.match(headerRuntime, /pointerdown/);
  assert.match(headerRuntime, /classList\.remove\(KEYBOARD_NAVIGATION_CLASS\)/);
});
