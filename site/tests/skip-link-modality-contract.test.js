import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');

test('keyboard modality is established only for a real Tab focus transition', () => {
  assert.match(runtime, /KEYBOARD_NAVIGATION_CLASS = 'keyboard-navigation'/);
  assert.match(runtime, /const skipLink = document\.querySelector\('\.skip-link'\)/);
  assert.match(runtime, /document\.addEventListener\('keydown',[\s\S]*event\.key !== 'Tab' \|\| !event\.isTrusted[\s\S]*capture: true/);
  assert.match(runtime, /document\.documentElement\.classList\.add\(KEYBOARD_NAVIGATION_CLASS\)/);
});

test('keyboard modality does not stay sticky after focus moves elsewhere', () => {
  assert.match(runtime, /setTimeout\(\(\) => \{[\s\S]*document\.activeElement !== skipLink[\s\S]*clearKeyboardNavigation\(\)/);
  assert.match(runtime, /document\.addEventListener\('focusout',[\s\S]*event\.target === skipLink[\s\S]*clearKeyboardNavigation\(\)[\s\S]*capture: true/);
  assert.match(runtime, /document\.addEventListener\('pointerdown', clearKeyboardNavigation, \{ capture: true \}\)/);
});

test('programmatic skip-link focus stays invisible while genuine keyboard focus can be shown', () => {
  assert.match(css, /\.skip-link:focus\s*\{[\s\S]*opacity:\s*0[\s\S]*pointer-events:\s*none/);
  assert.match(css, /html\.keyboard-navigation \.skip-link:focus\s*\{[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto/);
});
