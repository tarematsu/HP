import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('track history R2 missing body exits before metadata parsing', () => {
  const start = source.indexOf('async function loadWorkerR2Response');
  const block = source.slice(start, source.indexOf('export async function loadMaterializedR2Response'));
  assert.equal(block.indexOf('if (!object?.body) return null;') < block.indexOf('objectOrNull(object.customMetadata)'), true);
});
