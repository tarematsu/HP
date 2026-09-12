import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/homepanel-unified-ci.yml', import.meta.url),
  'utf8',
);

test('HomePanel unified CI preserves the video full trigger on PRs and main', () => {
  const matches = workflow.match(/- 'hp\/video\/\.ci-full-trigger'/g) || [];
  assert.equal(matches.length, 2);
});
