import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_CLOUDFLARE_WORKERS,
  configuredWorkers,
  evaluateCollectionCoverage,
  renderCollectionSummary,
} from '../.github/scripts/audit-observability-collection.mjs';

function completeEvidence() {
  return {
    configured: [...REQUIRED_CLOUDFLARE_WORKERS],
    deployments: Object.fromEntries(REQUIRED_CLOUDFLARE_WORKERS.map((worker) => [worker, {
      status: 'active',
      deployment_id: `deployment-${worker}`,
      version_ids: [`version-${worker}`],
    }])),
    observabilitySummary: REQUIRED_CLOUDFLARE_WORKERS
      .map((worker) => `| \`${worker}\` | 1 | 0 | 0.00% | 0 |`)
      .join('\n'),
    telemetryLog: REQUIRED_CLOUDFLARE_WORKERS
      .map((worker) => `CPU_WORKER worker=${worker} version=v1 samples=1 avg_ms=1 max_ms=1`)
      .join('\n'),
    liveTailLog: REQUIRED_CLOUDFLARE_WORKERS
      .map((worker) => `LIVE_TAIL_SUMMARY worker=${worker} events=0 error_like=0 max_cpu_field=null`)
      .join('\n'),
    publicHealthSummary: '| Endpoint | Result | HTTP |\n| health | success | 200 OK |',
    observabilityQueryLog: 'query completed without fallback',
  };
}

test('collection audit requires all four Stationhead Workers and HomePanel', () => {
  assert.deepEqual(configuredWorkers(REQUIRED_CLOUDFLARE_WORKERS.join(',')), REQUIRED_CLOUDFLARE_WORKERS);
  const result = evaluateCollectionCoverage(completeEvidence());
  assert.equal(result.failures.length, 0);
  assert.match(renderCollectionSummary(result), /Overall: `OK`/);
});

test('collection audit fails closed for missing Worker, deployment, metrics, telemetry, live tail, public health, or unsafe fallback', () => {
  const evidence = completeEvidence();
  evidence.configured = evidence.configured.filter((worker) => worker !== 'sh-buddies-recovery');
  delete evidence.deployments['sh-buddies-collector'];
  evidence.observabilitySummary = evidence.observabilitySummary.replace(/^.*sh-sakurazaka46jp.*$/m, '');
  evidence.telemetryLog = evidence.telemetryLog.replace(/^CPU_WORKER worker=homepanel-cloud.*$/m, '');
  evidence.liveTailLog = evidence.liveTailLog.replace(/^LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator.*$/m, '');
  evidence.publicHealthSummary = '';
  evidence.observabilityQueryLog = '::warning title=Telemetry filter fallback::filter rejected';

  const result = evaluateCollectionCoverage(evidence);
  for (const name of [
    'Configured Worker contract',
    'Active deployment: sh-buddies-collector',
    'Metrics row: sh-sakurazaka46jp',
    'Telemetry audit: homepanel-cloud',
    'Live tail: sh-runtime-orchestrator',
    'Public health snapshot',
    'Persisted diagnostic filter integrity',
  ]) assert.ok(result.failures.some((check) => check.name === name), name);
  assert.match(renderCollectionSummary(result), /Overall: `FAILURE`/);
});
