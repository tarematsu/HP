#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { sanitizeText } from './observability-status-publisher.mjs';

export const REQUIRED_CLOUDFLARE_WORKERS = Object.freeze([
  'sh-sakurazaka46jp',
  'sh-buddies-recovery',
  'sh-buddies-collector',
  'sh-runtime-orchestrator',
  'homepanel-cloud',
]);

export const REQUIRED_PUBLIC_HEALTH_ENDPOINTS = Object.freeze([
  'Unified health',
  'HomePanel Cloud health',
]);

function compact(value, maximum = 300) {
  const text = sanitizeText(String(value || '')).replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function configuredWorkers(value) {
  return String(value || '')
    .split(',')
    .map((worker) => worker.trim())
    .filter(Boolean);
}

export function evaluateCollectionCoverage({
  configured = [],
  deployments = {},
  observabilitySummary = '',
  telemetryLog = '',
  liveTailLog = '',
  publicHealthSummary = '',
  observabilityQueryLog = '',
} = {}) {
  const checks = [];
  const add = (name, ok, evidence) => checks.push({ name, ok: Boolean(ok), evidence: compact(evidence) });
  const configuredSet = new Set(configured);
  const duplicates = configured.filter((worker, index) => configured.indexOf(worker) !== index);
  const missingConfigured = REQUIRED_CLOUDFLARE_WORKERS.filter((worker) => !configuredSet.has(worker));

  add('Configured Worker contract', !duplicates.length && !missingConfigured.length,
    duplicates.length
      ? `Duplicate Worker entries: ${[...new Set(duplicates)].join(', ')}`
      : missingConfigured.length
        ? `Required Workers missing from CLOUDFLARE_WORKERS: ${missingConfigured.join(', ')}`
        : `${configured.length} Workers configured, including all four Stationhead Workers and HomePanel.`);

  for (const worker of REQUIRED_CLOUDFLARE_WORKERS) {
    const deployment = deployments?.[worker];
    const versions = Array.isArray(deployment?.version_ids) ? deployment.version_ids.filter(Boolean) : [];
    add(
      `Active deployment: ${worker}`,
      deployment?.status === 'active' && Boolean(String(deployment?.deployment_id || '').trim()) && versions.length > 0,
      deployment
        ? `status=${deployment.status || 'unknown'} deployment=${deployment.deployment_id || 'missing'} versions=${versions.length}`
        : 'Worker is absent from active-worker-deployments.json.',
    );

    const activityRow = new RegExp(`^\\|\\s*\`${escapeRegExp(worker)}\`\\s*\\|`, 'm').test(observabilitySummary);
    add(
      `Metrics row: ${worker}`,
      activityRow,
      activityRow ? 'Worker activity row was captured.' : 'Worker activity row is missing from observability-summary.md.',
    );

    const telemetryMarker = new RegExp(`^CPU_WORKER worker=${escapeRegExp(worker)}\\b`, 'm').test(telemetryLog);
    add(
      `Telemetry audit: ${worker}`,
      telemetryMarker,
      telemetryMarker ? 'Current-deployment telemetry audit emitted a Worker result.' : 'CPU_WORKER marker is missing from telemetry-audit.log.',
    );

    const liveTailSummary = new RegExp(`^LIVE_TAIL_SUMMARY worker=${escapeRegExp(worker)}\\b`, 'm').test(liveTailLog);
    add(
      `Live tail: ${worker}`,
      liveTailSummary,
      liveTailSummary ? 'Live Tail connected and completed.' : 'LIVE_TAIL_SUMMARY is missing; connection or collection did not complete.',
    );
  }

  for (const endpoint of REQUIRED_PUBLIC_HEALTH_ENDPOINTS) {
    const successfulRow = new RegExp(
      `^\\|\\s*${escapeRegExp(endpoint)}\\s*\\|\\s*success\\s*\\|\\s*200(?:\\s+OK)?\\s*\\|`,
      'mi',
    ).test(publicHealthSummary);
    add(
      `Public health: ${endpoint}`,
      successfulRow,
      successfulRow
        ? `${endpoint} returned a definitive HTTP 200 success.`
        : `${endpoint} is missing or did not return HTTP 200 success.`,
    );
  }

  const unsafeFallback = /::warning title=Telemetry filter fallback::/m.test(observabilityQueryLog);
  add(
    'Persisted diagnostic filter integrity',
    !unsafeFallback,
    unsafeFallback
      ? 'The combined Worker filter was rejected and the legacy account-wide fallback was used; results may be truncated before monitored Workers are selected.'
      : 'No unsafe account-wide telemetry fallback was used.',
  );

  return {
    checks,
    failures: checks.filter((check) => !check.ok),
  };
}

async function optionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

export function renderCollectionSummary(result) {
  const rows = result.checks.map((check) => (
    `| ${check.ok ? 'OK' : 'FAIL'} | ${check.name.replaceAll('|', '\\|')} | ${check.evidence.replaceAll('|', '\\|')} |`
  ));
  return `## Observability collection integrity\n\n- Overall: \`${result.failures.length ? 'FAILURE' : 'OK'}\`\n- Required Workers: \`${REQUIRED_CLOUDFLARE_WORKERS.join('`, `')}\`\n- Required public health: \`${REQUIRED_PUBLIC_HEALTH_ENDPOINTS.join('`, `')}\`\n- Failed checks: \`${result.failures.length}\`\n\n| State | Check | Evidence |\n|---|---|---|\n${rows.join('\n')}`;
}

async function selfTest() {
  const workerRows = REQUIRED_CLOUDFLARE_WORKERS.map((worker) => `| \`${worker}\` | 1 | 0 |`).join('\n');
  const deploymentEntries = Object.fromEntries(REQUIRED_CLOUDFLARE_WORKERS.map((worker) => [worker, {
    status: 'active',
    deployment_id: `${worker}-deployment`,
    version_ids: [`${worker}-version`],
  }]));
  const telemetry = REQUIRED_CLOUDFLARE_WORKERS.map((worker) => `CPU_WORKER worker=${worker} version=v1 samples=1`).join('\n');
  const liveTail = REQUIRED_CLOUDFLARE_WORKERS.map((worker) => `LIVE_TAIL_SUMMARY worker=${worker} events=0 error_like=0 max_cpu_field=null`).join('\n');
  const publicHealth = REQUIRED_PUBLIC_HEALTH_ENDPOINTS
    .map((endpoint) => `| ${endpoint} | success | 200 OK | 10 ms |`)
    .join('\n');
  const healthy = evaluateCollectionCoverage({
    configured: [...REQUIRED_CLOUDFLARE_WORKERS],
    deployments: deploymentEntries,
    observabilitySummary: workerRows,
    telemetryLog: telemetry,
    liveTailLog: liveTail,
    publicHealthSummary: publicHealth,
  });
  assert.equal(healthy.failures.length, 0);

  const broken = evaluateCollectionCoverage({
    configured: REQUIRED_CLOUDFLARE_WORKERS.filter((worker) => worker !== 'sh-buddies-recovery'),
    deployments: deploymentEntries,
    observabilitySummary: workerRows,
    telemetryLog: telemetry,
    liveTailLog: liveTail.replace(/^LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator.*$/m, ''),
    publicHealthSummary: publicHealth.replace(/^.*HomePanel Cloud health.*$/m, ''),
    observabilityQueryLog: '::warning title=Telemetry filter fallback::rejected',
  });
  assert.ok(broken.failures.some((check) => check.name === 'Configured Worker contract'));
  assert.ok(broken.failures.some((check) => check.name === 'Live tail: sh-runtime-orchestrator'));
  assert.ok(broken.failures.some((check) => check.name === 'Public health: HomePanel Cloud health'));
  assert.ok(broken.failures.some((check) => check.name === 'Persisted diagnostic filter integrity'));
  console.log('observability collection integrity self-test passed');
}

export async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    return 0;
  }
  const [deployments, observabilitySummary, telemetryLog, liveTailLog, publicHealthSummary, observabilityQueryLog] = await Promise.all([
    optionalJson(process.env.ACTIVE_WORKER_DEPLOYMENTS_OUTPUT || 'active-worker-deployments.json'),
    optionalText(process.env.OBSERVABILITY_SUMMARY_FILE || 'observability-summary.md'),
    optionalText(process.env.TELEMETRY_LOG_FILE || 'telemetry-audit.log'),
    optionalText(process.env.LIVE_TAIL_LOG || 'live-tail.log'),
    optionalText(process.env.PUBLIC_HEALTH_SUMMARY_FILE || 'public-health-endpoints.md'),
    optionalText(process.env.OBSERVABILITY_QUERY_LOG_FILE || 'observability-query.log'),
  ]);
  const result = evaluateCollectionCoverage({
    configured: configuredWorkers(process.env.CLOUDFLARE_WORKERS),
    deployments,
    observabilitySummary,
    telemetryLog,
    liveTailLog,
    publicHealthSummary,
    observabilityQueryLog,
  });
  const summary = renderCollectionSummary(result);
  const output = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
  if (output) await writeFile(output, `${summary}\n`, 'utf8');
  else console.log(summary);
  for (const failure of result.failures) {
    console.error(`::error title=Observability collection incomplete::check=${failure.name} evidence=${failure.evidence}`);
  }
  return result.failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`::error title=Observability collection audit::${compact(error?.message || error, 1000)}`);
    process.exitCode = 1;
  });
}
