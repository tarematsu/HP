import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const dailyPath = '.github/scripts/audit-cloudflare-daily-usage.py';
const freeTierPath = '.github/scripts/audit-cloudflare-free-tier.py';
const daily = readFileSync(new URL(`../${dailyPath}`, import.meta.url), 'utf8');
const workflow = readFileSync(
  new URL('../.github/workflows/sh-observability.yml', import.meta.url),
  'utf8',
);
const freeTier = readFileSync(
  new URL('../.github/scripts/cloudflare_free_tier_audit.py', import.meta.url),
  'utf8',
);

function runSelfTest(path) {
  const result = spawnSync('python3', [path, '--self-test'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${path}\n${result.stdout}\n${result.stderr}`);
}

test('partial UTC-day budget audits pass executable projection tests', () => {
  runSelfTest(dailyPath);
  runSelfTest(freeTierPath);
});

test('production Worker and D1 gates enforce projected values immediately', () => {
  assert.match(daily, /"method": "linear-from-utc-midnight"/);
  assert.match(daily, /DAY_SECONDS \/ elapsed/);
  assert.match(daily, /DAILY_PROJECTION_MIN_ELAPSED_SECONDS/);
  assert.match(daily, /"enforceProjected": elapsed >= PROJECTION_MIN_ELAPSED_SECONDS/);
  assert.match(workflow, /DAILY_PROJECTION_MIN_ELAPSED_SECONDS: "0"/);
  assert.match(daily, /"actualUsage": actual/);
  assert.match(daily, /"violationSources": violation_sources/);
  assert.match(daily, /"queueOperations"/);
  assert.match(daily, /usage = project_daily_usage\(actual, projection, REQUEST_RESERVE\)/);
  assert.match(
    daily,
    /violations, violation_sources = evaluate\(actual, usage, LIMITS, projection\["enforceProjected"\]\)/,
  );
  assert.match(daily, /Actual to now \| Projected 24h/);
  assert.match(daily, /actual=.*projected=/);
});

test('account-wide gate projects only daily allowance meters', () => {
  for (const metric of [
    'queueOperations',
    'doRequests',
    'doActiveGbSeconds',
    'doRowsRead',
    'doRowsWritten',
    'kvReads',
    'kvWrites',
    'kvDeletes',
    'kvLists',
  ]) {
    assert.match(freeTier, new RegExp(`"${metric}"`));
  }
  assert.match(freeTier, /_MONTHLY_OR_STATE_METRICS/);
  assert.match(freeTier, /project_daily_allowances\(actual, projection\)/);
  assert.match(freeTier, /"actualUsage": actual/);
  assert.match(freeTier, /mixed-daily-projection-and-period-actual/);
  assert.match(freeTier, /Daily meters: projected from 00:00 UTC to 24 hours/);
  assert.match(freeTier, /Monthly and storage meters: unprojected observed values/);
  assert.match(freeTier, /for key in _MONTHLY_OR_STATE_METRICS:/);
  assert.match(freeTier, /assert projected\[key\] == actual\[key\]/);
});
