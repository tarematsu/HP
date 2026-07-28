import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const action = read('.github/actions/cloudflare-observability-diagnostics/action.yml');
const workflow = read('.github/workflows/sh-observability.yml');
const resolver = read('.github/scripts/observability-workflow-outcome.mjs');

test('shared diagnostics action owns persisted-query and live-tail orchestration', () => {
  assert.match(action, /python3 \.github\/scripts\/query-cloudflare-observability\.py/);
  assert.match(action, /node \.github\/scripts\/capture-cloudflare-live-tail\.mjs/);
  assert.match(action, /wait "\$query_pid" \|\| query_status=\$\?/);
  assert.match(action, /wait "\$tail_pid" \|\| true/);
  assert.match(action, /^outputs:\n[\s\S]*query-outcome:/m);
  assert.match(action, /id: collect/);
  assert.match(action, /echo "query-outcome=\$query_outcome" >> "\$GITHUB_OUTPUT"/);
  assert.match(action, /echo "public-health-outcome=\$public_health_outcome" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(action, /exit "\$health_status"/);
});

test('the unified workflow uses and retriggers the diagnostics action for HP and Stationhead', () => {
  assert.match(
    workflow,
    /^\s{6}- '\.github\/actions\/cloudflare-observability-diagnostics\/action\.yml'$/m,
  );
  assert.match(
    workflow,
    /^\s{8}uses: \.\/\.github\/actions\/cloudflare-observability-diagnostics$/m,
  );
  assert.doesNotMatch(workflow, /query_pid=\$!/);
  assert.match(workflow, /^\s{10}live-tail-worker: sh-runtime-orchestrator$/m);
  assert.match(
    workflow,
    /CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud/,
  );
  assert.doesNotMatch(workflow, /homepanel-cloud,homepanel-video/);
  assert.match(workflow, /workflows: \["Deploy production", "Deploy HomePanel Cloud services"\]/);
  assert.match(
    workflow,
    /OBSERVABILITY_QUERY_OUTCOME: \$\{\{ steps\.observability-query\.outputs\.query-outcome \}\}/,
  );
  assert.match(workflow, /name: Resolve semantic observability outcome/);
  assert.match(resolver, /readOptionalText\('public-health-endpoints\.md'\)/);
  assert.match(resolver, /observabilityIssueOverall/);
  assert.match(workflow, /steps\.resolve-outcome\.outputs\.overall == 'failure'/);
  assert.doesNotMatch(
    workflow,
    /OBSERVABILITY_QUERY_OUTCOME: \$\{\{ steps\.observability-query\.outcome \}\}/,
  );
});

test('ambiguous and superseded observability implementations stay removed', async () => {
  for (const path of [
    '../.github/actions/cloudflare-observability-query/action.yml',
    '../.github/scripts/audit-cloudflare-telemetry-core.py',
    '../.github/scripts/enforce-worker-cpu-budget.py',
    '../.github/workflows/hp-observability.yml',
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)), path);
  }
});
