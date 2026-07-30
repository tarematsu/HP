import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');

test('keyboard modality is established before focus moves on Tab', () => {
  assert.match(runtime, /document\.addEventListener\('keydown',[\s\S]*event\.key === 'Tab'[\s\S]*capture: true/);
  assert.match(runtime, /document\.documentElement\.classList\.add\(KEYBOARD_NAVIGATION_CLASS\)/);
});

test('pointer input clears keyboard modality and programmatic focus stays invisible', () => {
  assert.match(runtime, /document\.addEventListener\('pointerdown',[\s\S]*classList\.remove\(KEYBOARD_NAVIGATION_CLASS\)[\s\S]*capture: true/);
  assert.match(css, /\.skip-link:focus\s*\{[\s\S]*opacity:\s*0[\s\S]*pointer-events:\s*none/);
  assert.match(css, /html\.keyboard-navigation \.skip-link:focus\s*\{[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto/);
});
