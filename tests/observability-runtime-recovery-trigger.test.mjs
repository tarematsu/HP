import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/sh-observability.yml', import.meta.url),
  'utf8',
);

test('observability refreshes after runtime maintenance completes', () => {
  assert.match(
    workflow,
    /workflows: \["Deploy production", "Deploy HomePanel Cloud services", "Run runtime offline maintenance"\]/,
  );
  assert.match(
    workflow,
    /github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.conclusion == 'success'/,
  );
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/,
  );
});
