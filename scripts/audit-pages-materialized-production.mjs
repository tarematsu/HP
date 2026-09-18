import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DAY_MS = 86_400_000;
const RECENT_DAILY_WINDOW_DAYS = 45;
const args = process.argv.slice(2);
const outArg = args.find((arg) => arg.startsWith('--out='));
const outPath = outArg?.slice('--out='.length) || '.pages-production-audit/materialized.json';
const auditScript = resolve(import.meta.dirname, 'audit-pages-materialized.mjs');

function dailyFailureDate(message) {
  const text = String(message || '');
  const incomplete = text.match(/^(?:history:daily data: )?(\d{4}-\d{2}-\d{2}) (?:is incomplete|has only )/);
  if (incomplete) return incomplete[1];
  const missing = text.match(/^(?:history:daily data: )?missing daily period: (\d{4}-\d{2}-\d{2})(?:\s|$)/);
  return missing?.[1] || null;
}

function isArchivalDailyFailure(message, cutoff) {
  const key = dailyFailureDate(message);
  if (!key) return false;
  const timestamp = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(timestamp) && timestamp < cutoff;
}

function moveArchivalFailures(failures, warnings, cutoff, prefix = '') {
  const kept = [];
  const nextWarnings = [...(Array.isArray(warnings) ? warnings : [])];
  for (const failure of Array.isArray(failures) ? failures : []) {
    if (!isArchivalDailyFailure(failure, cutoff)) {
      kept.push(failure);
      continue;
    }
    const warning = `${prefix}${String(failure).replace(/^history:daily data: /, '')} (archival source gap)`;
    if (!nextWarnings.includes(warning)) nextWarnings.push(warning);
  }
  return { failures: kept, warnings: nextWarnings };
}

const child = spawnSync(process.execPath, [auditScript, ...args], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  stdio: ['inherit', 'inherit', 'inherit'],
});

let report;
try {
  report = JSON.parse(await readFile(outPath, 'utf8'));
} catch (error) {
  console.error(`Could not read materialized audit report ${outPath}: ${error?.message || error}`);
  process.exit(child.status || 1);
}

const generatedAt = Date.parse(String(report.generatedAt || ''));
const anchor = Number.isFinite(generatedAt) ? generatedAt : Date.now();
const cutoff = anchor - RECENT_DAILY_WINDOW_DAYS * DAY_MS;

for (const variant of Array.isArray(report.variants) ? report.variants : []) {
  if (variant?.key !== 'history:daily') continue;
  const moved = moveArchivalFailures(variant.failures, variant.warnings, cutoff);
  variant.failures = moved.failures;
  variant.warnings = moved.warnings;
  if (variant.dataIntegrity && typeof variant.dataIntegrity === 'object') {
    const integrity = moveArchivalFailures(
      variant.dataIntegrity.failures,
      variant.dataIntegrity.warnings,
      cutoff,
    );
    variant.dataIntegrity.failures = integrity.failures;
    variant.dataIntegrity.warnings = integrity.warnings;
  }
}

const topLevel = moveArchivalFailures(report.failures, report.warnings, cutoff, 'history:daily data: ');
report.failures = topLevel.failures;
report.warnings = topLevel.warnings;
report.ok = report.failures.length === 0
  && (Array.isArray(report.variants) ? report.variants.every((variant) => !(variant.failures || []).length) : true);
report.productionPolicy = {
  recent_daily_window_days: RECENT_DAILY_WINDOW_DAYS,
  archival_daily_gaps: 'warning',
  recent_daily_gaps: 'failure',
};

await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  event: 'pages_materialized_production_policy',
  ok: report.ok,
  failure_count: report.failures.length,
  warning_count: report.warnings.length,
  recent_daily_cutoff: new Date(cutoff).toISOString().slice(0, 10),
}));

process.exit(report.ok ? 0 : (child.status || 1));