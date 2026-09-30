import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
  'utf8',
);

function jobSection(name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `${name} job must exist`);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + 1);
  assert.notEqual(end, -1, `${nextName} job must exist after ${name}`);
  return workflow.slice(start, end);
}

test('OTHER_DB reusable deployment receives a bounded migration diff range', () => {
  const otherDb = jobSection('other_db', 'workers');
  assert.match(otherDb, /operation: other-db/);
  assert.match(otherDb, /base_sha: \$\{\{ github\.event\.before \|\| github\.sha \}\}/);
  assert.match(otherDb, /head_sha: \$\{\{ github\.sha \}\}/);
});
