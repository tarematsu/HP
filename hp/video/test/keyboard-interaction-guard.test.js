import assert from 'node:assert/strict';
import test from 'node:test';

import { preservesInteractiveKey } from '../public/keyboard-interaction-guard.js';

test('native keyboard behavior is preserved for controls and form fields', () => {
  assert.equal(preservesInteractiveKey('button', ' '), true);
  assert.equal(preservesInteractiveKey('input', 'ArrowLeft'), true);
  assert.equal(preservesInteractiveKey('input', 'ArrowUp'), true);
  assert.equal(preservesInteractiveKey('textarea', 'Home'), true);
  assert.equal(preservesInteractiveKey('select', 'Enter'), true);
});

test('global shortcuts remain available outside interactive elements', () => {
  assert.equal(preservesInteractiveKey('div', ' '), false);
  assert.equal(preservesInteractiveKey('main', 'ArrowDown'), false);
  assert.equal(preservesInteractiveKey('button', 'm'), false);
});

test('contenteditable elements retain editing keys', () => {
  assert.equal(preservesInteractiveKey('div', 'ArrowRight', true), true);
  assert.equal(preservesInteractiveKey('div', 'k', true), false);
});
