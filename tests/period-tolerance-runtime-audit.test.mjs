import { browserSource } from '../site/tests/helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MONTHLY_BOUNDARY_TOLERANCE_MS,
  WEEKLY_BOUNDARY_TOLERANCE_MS,
  evaluatePeriodCompleteness,
  expectedPeriodBounds,
  periodBoundaryToleranceMs,
} from '../site/functions/lib/period-completeness.js';

test('weekly/monthly boundary tolerance is approximately five percent of the period', () => {
  assert.equal(periodBoundaryToleranceMs('weekly'), 7 * 86400000 * 0.05);
  assert.equal(periodBoundaryToleranceMs('monthly'), 30 * 86400000 * 0.05);
  assert.equal(periodBoundaryToleranceMs('monthly', '2026-05'), 31 * 86400000 * 0.05);

  for (const [mode, key] of [
    ['weekly', '2026-07-06'],
    ['monthly', '2026-05'],
  ]) {
    const bounds = expectedPeriodBounds(mode, key);
    const tolerance = periodBoundaryToleranceMs(mode, key);
    const accepted = evaluatePeriodCompleteness({
      mode,
      periodKey: key,
      firstObservedAt: bounds.start - tolerance,
      lastObservedAt: bounds.end + tolerance,
      now: bounds.end + tolerance + 1,
    });
    assert.equal(accepted.complete, true);

    const rejected = evaluatePeriodCompleteness({
      mode,
      periodKey: key,
      firstObservedAt: bounds.start - tolerance - 1,
      lastObservedAt: bounds.end,
      now: bounds.end + tolerance + 1,
    });
    assert.ok(rejected.reasons.includes('missing_period_start'));
  }
});

test('history runtime keeps table ownership consolidated while charts are mode-specific', () => {
  const runtime = browserSource('history/history-lite.js');
  const html = readFileSync(new URL('../site/public/index.html', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../site/public/history-shell.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../site/public/dashboard-tabs.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../site/public/history/history-main.js', import.meta.url), 'utf8');

  assert.match(runtime, /CACHE_PREFIX = 'sh\.history\.v3:'/);
  assert.match(runtime, /function updateSummary\(\)/);
  assert.match(runtime, /state\.rows = Array\.isArray\(data\.rows\) \? data\.rows : \[\]/);
  assert.match(runtime, /history:data-loaded/);
  assert.doesNotMatch(runtime, /mondayJstKey|expectedStart|expectedEnd|prepareCanvas|drawSummaryChart/);
  assert.match(shell, /id: 'historyView'/);
  assert.match(tabs, /import\('\/history\/history-main\.js\?v=\d{8}\.\d+'\)/);
  assert.match(entry, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.doesNotMatch(entry, /history-ranking-missing-gap/);
  assert.doesNotMatch([html, shell].join('\n'), /history-period-completeness\.js|history-track-likes\.js/);
});