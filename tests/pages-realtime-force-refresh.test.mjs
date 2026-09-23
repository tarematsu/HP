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
const watchdog = readFileSync(
  new URL('../worker/src/pages-realtime-read-model-watchdog.js', import.meta.url),
  'utf8',
);

test('realtime Pages refresh forces a fresh dashboard on push and watchdog/manual dispatch', () => {
  assert.match(
    workflow,
    /PAGES_READ_MODEL_FORCE_DASHBOARD: \$\{\{ github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch' \}\}/,
  );
  assert.match(refreshScript, /PAGES_READ_MODEL_FORCE_DASHBOARD/);
  assert.match(refreshScript, /forced-realtime:/);
  assert.match(refreshScript, /process\.env\.GITHUB_SHA/);
  assert.match(refreshScript, /rendererRevision/);
});

test('realtime dashboard has no independent Actions cron and is dispatched by the Worker watchdog', () => {
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.doesNotMatch(workflow, /cron:/);
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.match(watchdog, /PAGES_REALTIME_WATCHDOG_INTERVAL_MS = 5 \* 60_000/);
  assert.match(watchdog, /PAGES_REALTIME_STALE_AFTER_MS = 9 \* 60_000/);
  assert.match(watchdog, /refresh-pages-realtime\.yml\/dispatches/);
});
