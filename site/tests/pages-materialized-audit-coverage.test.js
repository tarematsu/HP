import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { auditPayloadCompleteness } from '../../scripts/audit-pages-materialized.mjs';

const audit = readFileSync(new URL('../../scripts/audit-pages-materialized.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/pages-live-browser-audit.yml', import.meta.url), 'utf8');

test('production materialized audit checks every bounded API variant', () => {
  assert.match(audit, /MATERIALIZED_API_VARIANTS/);
  assert.match(audit, /for \(const variant of MATERIALIZED_API_VARIANTS\)/);
  assert.match(audit, /payload\.ok !== true/);
  assert.match(audit, /used fallback path/);
  assert.match(audit, /x-api-source/);
  assert.match(audit, /x-materialized-at/);
  assert.match(audit, /is stale by/);
});

test('materialized audit checks data completeness without issuing another request', () => {
  assert.match(audit, /auditPayloadCompleteness\(variant\.key, payload/);
  assert.match(audit, /Data completeness reuses these already-fetched materialized responses/);
  assert.match(audit, /Pages data completeness/);
  assert.match(audit, /missing \$\{mode\} period/);
  assert.match(audit, /sakurazaka46jp_recent_sessions is empty/);
});

test('daily completeness detects unexpected gaps but tolerates the declared collection gap', () => {
  const now = Date.parse('2026-05-03T06:00:00Z');
  const payload = {
    ok: true,
    rows: [
      { period_key: '2026-04-29', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
      { period_key: '2026-05-01', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
      { period_key: '2026-05-02', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
    ],
  };
  const result = auditPayloadCompleteness('history:daily', payload, { now, materializedAt: now });
  assert.equal(result.failures.length, 0);
  assert.equal(result.gapCount, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('2026-04-30')));
});

test('daily completeness permits sparse historical cadence but still fails a missing recent day', () => {
  const now = Date.parse('2026-05-04T06:00:00Z');
  const payload = {
    ok: true,
    rows: [
      { period_key: '2026-05-01', sample_count: 288, reliable_sample_count: 288, period_complete: true },
      { period_key: '2026-05-03', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
    ],
  };
  const result = auditPayloadCompleteness('history:daily', payload, { now, materializedAt: now });
  assert.equal(result.failures.some((failure) => failure.includes('288/1440')), false);
  assert.ok(result.failures.some((failure) => failure.includes('missing daily period: 2026-05-02')));
});

test('daily completeness fails rows explicitly marked incomplete by boundary validation', () => {
  const now = Date.parse('2026-05-04T06:00:00Z');
  const payload = {
    ok: true,
    rows: [{
      period_key: '2026-05-03',
      sample_count: 1108,
      reliable_sample_count: 1108,
      period_complete: false,
      exclusion_reasons: ['missing_period_end'],
    }],
  };
  const result = auditPayloadCompleteness('history:daily', payload, { now, materializedAt: now });
  assert.ok(result.failures.some((failure) => failure.includes('missing_period_end')));
});

test('daily completeness accepts read-model placeholders in the declared missing period', () => {
  const now = Date.parse('2026-06-24T06:00:00Z');
  const result = auditPayloadCompleteness('history:daily', {
    ok: true,
    rows: [
      { period_key: '2026-06-21', known_missing: true, synthetic_missing: true, sample_count: '-', reliable_sample_count: '-', period_complete: false },
      { period_key: '2026-06-22', known_missing: true, synthetic_missing: true, sample_count: '-', reliable_sample_count: '-', period_complete: false },
      { period_key: '2026-06-23', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
    ],
  }, { now, materializedAt: now });
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('2026-06-21')));
});

test('daily completeness still rejects a missing placeholder outside the declared period', () => {
  const now = Date.parse('2026-06-25T06:00:00Z');
  const result = auditPayloadCompleteness('history:daily', {
    ok: true,
    rows: [
      { period_key: '2026-06-23', known_missing: true, sample_count: '-', reliable_sample_count: '-', period_complete: true },
      { period_key: '2026-06-24', sample_count: 1440, reliable_sample_count: 1440, period_complete: true },
    ],
  }, { now, materializedAt: now });
  assert.ok(result.failures.some((failure) => failure.includes('invalid sample_count')));
});

test('host summary completeness fails on an empty recent-session model', () => {
  const result = auditPayloadCompleteness('host-history:summary', {
    ok: true,
    sakurazaka46jp_recent_sessions: [],
  });
  assert.deepEqual(result.failures, ['sakurazaka46jp_recent_sessions is empty']);
});

test('production audit is strict after deploy and read-model rebuild', () => {
  assert.match(workflow, /workflows: \['Deploy production', 'Rebuild pages read models'\]/);
  assert.match(workflow, /Require all production materializations/);
  assert.match(workflow, /--attempts="\$attempts"/);
  assert.match(workflow, /retry_delay_ms=30000/);
  assert.match(workflow, /continue-on-error: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});
