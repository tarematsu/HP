import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_CLOUDFLARE_WORKERS,
  REQUIRED_PUBLIC_HEALTH_ENDPOINTS,
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
    publicHealthSummary: REQUIRED_PUBLIC_HEALTH_ENDPOINTS
      .map((endpoint) => `| ${endpoint} | success | 200 OK | 10 ms |`)
      .join('\n'),
    observabilityQueryLog: 'query completed without fallback',
  };
}

test('collection audit requires all four Stationhead Workers, HomePanel, and both public health endpoints', () => {
  assert.deepEqual(configuredWorkers(REQUIRED_CLOUDFLARE_WORKERS.join(',')), REQUIRED_CLOUDFLARE_WORKERS);
  const result = evaluateCollectionCoverage(completeEvidence());
  assert.equal(result.failures.length, 0);
  const summary = renderCollectionSummary(result);
  assert.match(summary, /Overall: `OK`/);
  assert.match(summary, /HomePanel Cloud health/);
});

test('collection audit fails closed for missing Worker, deployment, metrics, telemetry, live tail, public health, or unsafe fallback', () => {
  const evidence = completeEvidence();
  evidence.configured = evidence.configured.filter((worker) => worker !== 'sh-buddies-recovery');
  delete evidence.deployments['sh-buddies-collector'];
  evidence.observabilitySummary = evidence.observabilitySummary.replace(/^.*sh-sakurazaka46jp.*$/m, '');
  evidence.telemetryLog = evidence.telemetryLog.replace(/^CPU_WORKER worker=homepanel-cloud.*$/m, '');
  evidence.liveTailLog = evidence.liveTailLog.replace(/^LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator.*$/m, '');
  evidence.publicHealthSummary = evidence.publicHealthSummary.replace(/^.*HomePanel Cloud health.*$/m, '');
  evidence.observabilityQueryLog = '::warning title=Telemetry filter fallback::filter rejected';

  const result = evaluateCollectionCoverage(evidence);
  for (const name of [
    'Configured Worker contract',
    'Active deployment: sh-buddies-collector',
    'Metrics row: sh-sakurazaka46jp',
    'Telemetry audit: homepanel-cloud',
    'Live tail: sh-runtime-orchestrator',
    'Public health: HomePanel Cloud health',
    'Persisted diagnostic filter integrity',
  ]) assert.ok(result.failures.some((check) => check.name === name), name);
  assert.match(renderCollectionSummary(result), /Overall: `FAILURE`/);
});

test('a generic successful endpoint cannot hide a missing required endpoint', () => {
  const evidence = completeEvidence();
  evidence.publicHealthSummary = '| Other endpoint | success | 200 OK | 1 ms |';
  const result = evaluateCollectionCoverage(evidence);
  for (const endpoint of REQUIRED_PUBLIC_HEALTH_ENDPOINTS) {
    assert.ok(result.failures.some((check) => check.name === `Public health: ${endpoint}`));
  }
});
