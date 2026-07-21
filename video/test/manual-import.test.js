import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImportSourceUrl } from '../src/manual-import.js';

test('manual import accepts sanitized HTTPS source pages', () => {
  assert.equal(
    normalizeImportSourceUrl('https://example.com/videos?page=2#player'),
    'https://example.com/videos?page=2'
  );
  assert.equal(
    normalizeImportSourceUrl('https://media-source.example/ranking?range=24h&metric=views'),
    'https://media-source.example/ranking?range=24h&metric=views'
  );
  assert.equal(normalizeImportSourceUrl('http://example.com/ranking'), null);
});

test('manual import uses a neutral fallback source URL', () => {
  assert.equal(
    normalizeImportSourceUrl(''),
    'https://example.invalid/manual-import'
  );
});
