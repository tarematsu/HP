import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('track history R2 freshness is checked before header parsing', () => {
  const start = source.indexOf('async function loadWorkerR2Response');
  const block = source.slice(start);
  const fresh = block.indexOf('if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;');
  const parse = block.indexOf("JSON.parse(metadata.headers_json || '{}')");
  assert.equal(fresh >= 0 && parse > fresh, true);
});
