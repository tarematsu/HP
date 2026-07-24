import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

export function readSource(path) {
  return readFileSync(new URL(path, root), 'utf8');
}

export function expectAll(source, markers) {
  for (const marker of markers) assert.ok(source.includes(marker), marker);
}

export function expectNone(source, markers) {
  for (const marker of markers) assert.ok(!source.includes(marker), marker);
}
