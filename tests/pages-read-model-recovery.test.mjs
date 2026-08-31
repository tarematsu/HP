import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  STALE_AFTER_MS,
  pagesRecoveryDecision,
} from '../.github/scripts/recover-pages-read-models.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const now = Date.parse('2026-09-01T00:00:00Z');

function run({ minutesAgo, status = 'completed', conclusion = 'success', id = 1 }) {
  return {
    id,
    status,
    conclusion,
    run_started_at: new Date(now - minutesAgo * 60_000).toISOString(),
  };
}

test('Pages recovery only dispatches a missing stale successful schedule', () => {
  assert.equal(STALE_AFTER_MS, 45 * 60_000);
  assert.deepEqual(pagesRecoveryDecision([run({ minutesAgo: 30 })], { now }).dispatch, false);
  assert.deepEqual(pagesRecoveryDecision([run({ minutesAgo: 46 })], { now }).dispatch, true);
  assert.deepEqual(pagesRecoveryDecision([], { now }).reason, 'no-pages-runs');
});

test('Pages recovery does not hide active or failed operational runs', () => {
  assert.equal(
    pagesRecoveryDecision([run({ minutesAgo: 90, status: 'in_progress', conclusion: '' })], { now }).reason,
    'pages-run-active',
  );
  assert.equal(
    pagesRecoveryDecision([run({ minutesAgo: 90, conclusion: 'failure' })], { now }).reason,
    'latest-pages-run-not-successful',
  );
});

test('Pages recovery watchdog is independent and budget-safe', () => {
  const recovery = read('.github/workflows/recover-pages-read-models.yml');
  const pages = read('.github/workflows/run-pages-read-model-rebuild.yml');
  const script = read('.github/scripts/recover-pages-read-models.mjs');

  assert.match(recovery, /workflows: \["Publish GitHub Actions runner health"\]/);
  assert.match(recovery, /cron: '13,43 \* \* \* \*'/);
  assert.match(recovery, /actions: write/);
  assert.match(recovery, /pages-read-model-recovery/);
  assert.doesNotMatch(recovery, /CLOUDFLARE|wrangler|d1 execute/i);

  assert.doesNotMatch(pages, /workflow_run:/);
  assert.match(pages, /force_all:/);
  assert.match(pages, /default: true/);
  assert.match(pages, /github\.event_name == 'push'/);
  assert.match(pages, /inputs\.force_all/);

  assert.match(script, /STALE_AFTER_MS = 45 \* 60_000/);
  assert.match(script, /runs\?branch=main&per_page=20/);
  assert.match(script, /inputs: \{ force_all: 'false' \}/);
  assert.match(script, /actions\/workflows\/\$\{workflow\}/);
});
