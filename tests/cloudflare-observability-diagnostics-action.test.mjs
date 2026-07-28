import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const action = read('.github/actions/cloudflare-observability-diagnostics/action.yml');
const workflow = read('.github/workflows/sh-observability.yml');
const resolver = read('.github/scripts/observability-workflow-outcome.mjs');
const collectionAudit = read('.github/scripts/audit-observability-collection.mjs');
const publicHealth = read('.github/scripts/capture-public-health-endpoints.mjs');
const workerPublicUrl = read('.github/scripts/cloudflare-worker-public-url.mjs');

const workerList = 'sh-sakurazaka46jp,sh-buddies-recovery,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud';

test('shared diagnostics action owns persisted-query, required public health, and fail-closed multi-Worker Live Tail orchestration', () => {
  assert.match(action, /python3 \.github\/scripts\/query-cloudflare-observability\.py/);
  assert.match(action, /node \.github\/scripts\/capture-cloudflare-live-tail\.mjs/);
  assert.match(action, /node \.github\/scripts\/capture-public-health-endpoints\.mjs/);
  assert.match(action, /live-tail-workers:/);
  assert.match(action, /IFS=',' read -ra requested_workers/);
  assert.match(action, /tail_pids\+=/);
  assert.match(action, /wait "\$\{tail_pids\[\$index\]\}" \|\| worker_status=\$\?/);
  assert.match(collectionAudit, /LIVE_TAIL_SUMMARY worker=/);
  assert.match(collectionAudit, /HomePanel Cloud health/);
  assert.match(publicHealth, /DEFAULT_CLOUDFLARE_PUBLIC_HEALTH_WORKERS/);
  assert.match(publicHealth, /resolveCloudflareWorkerPublicUrl/);
  assert.match(workerPublicUrl, /workers\/scripts\/\$\{encodedWorker\}\/subdomain/);
  assert.match(action, /^outputs:\n[\s\S]*query-outcome:/m);
  assert.match(action, /^outputs:\n[\s\S]*live-tail-outcome:/m);
  assert.match(action, /echo "live-tail-outcome=\$live_tail_outcome" >> "\$GITHUB_OUTPUT"/);
  assert.match(action, /Unsafe account-wide fallback was required/);
  assert.doesNotMatch(action, /wait "\$tail_pid" \|\| true/);
  assert.doesNotMatch(action, /set \+e[\s\S]*capture-cloudflare-live-tail/);
});

test('the unified workflow covers all active HP and Stationhead Workers and folds collection gaps into the telemetry gate', () => {
  assert.match(
    workflow,
    /^\s{6}- '\.github\/actions\/cloudflare-observability-diagnostics\/action\.yml'$/m,
  );
  assert.match(
    workflow,
    /^\s{8}uses: \.\/\.github\/actions\/cloudflare-observability-diagnostics$/m,
  );
  assert.match(workflow, new RegExp(`CLOUDFLARE_WORKERS: ${workerList}`));
  assert.match(workflow, /CLOUDFLARE_PUBLIC_HEALTH_WORKERS: "HomePanel Cloud health\|homepanel-cloud\|\/api\/health"/);
  assert.match(workflow, /live-tail-workers: \$\{\{ env\.CLOUDFLARE_WORKERS \}\}/);
  assert.match(workflow, /audit-observability-collection\.mjs/);
  assert.match(workflow, /LIVE_TAIL_OUTCOME: \$\{\{ steps\.observability-query\.outputs\.live-tail-outcome \}\}/);
  assert.match(workflow, /PUBLIC_HEALTH_OUTCOME: \$\{\{ steps\.observability-query\.outputs\.public-health-outcome \}\}/);
  assert.match(
    workflow,
    /OBSERVABILITY_QUERY_OUTCOME: \$\{\{ steps\.observability-query\.outputs\.query-outcome \}\}/,
  );
  assert.match(workflow, /name: Resolve semantic observability outcome/);
  assert.match(resolver, /readOptionalText\('public-health-endpoints\.md'\)/);
  assert.match(resolver, /observabilityIssueOverall/);
  assert.match(resolver, /publishObservabilitySystemStatusFromEnvironment/);
  assert.match(workflow, /steps\.resolve-outcome\.outputs\.overall == 'failure'/);
  assert.doesNotMatch(workflow, /homepanel-cloud,homepanel-video/);
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
