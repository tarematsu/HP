import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/refresh-pages-realtime.yml', import.meta.url),
  'utf8',
);
const refreshScript = readFileSync(
  new URL('../worker/scripts/refresh-pages-realtime-actions.mjs', import.meta.url),
  'utf8',
);

test('realtime Pages refresh forces a fresh dashboard on push and manual dispatch', () => {
  assert.match(
    workflow,
    /PAGES_READ_MODEL_FORCE_DASHBOARD: \$\{\{ github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch' \}\}/,
  );
  assert.match(refreshScript, /PAGES_READ_MODEL_FORCE_DASHBOARD/);
  assert.match(refreshScript, /forced-realtime:/);
  assert.match(refreshScript, /process\.env\.GITHUB_SHA/);
  assert.match(refreshScript, /rendererRevision/);
});

test('scheduled realtime refresh keeps the normal minimum-refresh coalescing path', () => {
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.doesNotMatch(
    workflow,
    /PAGES_READ_MODEL_FORCE_DASHBOARD:\s*['"]?true['"]?\s*$/m,
  );
  assert.match(refreshScript, /forceDashboardRefresh/);
  assert.match(refreshScript, /rendererRevision = forceDashboardRefresh \?/);
});
