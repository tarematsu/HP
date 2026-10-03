import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { liveTailContainsTelemetryViolations } from '../.github/scripts/observability-workflow-outcome.mjs';

const navigationCss = readFileSync(new URL('../site/public/dashboard-navigation.css', import.meta.url), 'utf8');

test('compact section tabs wrap long labels inside their half-width cells', () => {
  assert.match(
    navigationCss,
    /@media \(max-width: 760px\)[\s\S]*\.dashboard-section-tabs > button\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
  );
});

test('compact five-column Stationhead tabs wrap inside their grid cells', () => {
  assert.match(
    navigationCss,
    /@media \(max-width: 760px\)[\s\S]*#modeTabs\.mode-tabs\.dashboard-tabs > button,[\s\S]*\.stationhead-subtabs > button\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
  );
});

test('persisted CPU failures are contained only by enough clean current Live Tail samples', () => {
  const telemetryLog = [
    '::error worker=sh-runtime-orchestrator version=v1 cpu_ms=14 budget_ms=10 class=http',
    '::error worker=sh-runtime-orchestrator version=v1 cpu_ms=12 budget_ms=10 class=http',
  ].join('\n');
  const cleanTail = 'LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator events=14 error_like=0 max_cpu_field=8';
  assert.equal(liveTailContainsTelemetryViolations({ telemetryLog, liveTailLog: cleanTail }), true);
  assert.equal(liveTailContainsTelemetryViolations({
    telemetryLog,
    liveTailLog: 'LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator events=2 error_like=0 max_cpu_field=8',
  }), false);
  assert.equal(liveTailContainsTelemetryViolations({
    telemetryLog,
    liveTailLog: 'LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator events=14 error_like=1 max_cpu_field=8',
  }), false);
  assert.equal(liveTailContainsTelemetryViolations({
    telemetryLog,
    liveTailLog: 'LIVE_TAIL_SUMMARY worker=sh-runtime-orchestrator events=14 error_like=0 max_cpu_field=11',
  }), false);
});

test('every violating Worker must independently be clean in Live Tail', () => {
  const telemetryLog = [
    '::error worker=worker-a cpu_ms=11 budget_ms=10',
    '::error worker=worker-b cpu_ms=13 budget_ms=10',
  ].join('\n');
  const partialTail = 'LIVE_TAIL_SUMMARY worker=worker-a events=8 error_like=0 max_cpu_field=7';
  assert.equal(liveTailContainsTelemetryViolations({ telemetryLog, liveTailLog: partialTail }), false);
});
