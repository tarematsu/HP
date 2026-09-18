import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');

test('read-model rebuild follows changes to period completeness policy', () => {
  assert.match(workflow, /site\/functions\/lib\/period-completeness\.js/);
});
