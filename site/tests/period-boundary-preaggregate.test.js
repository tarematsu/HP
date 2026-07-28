import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  periodBoundaryCandidates,
  savePeriodBoundaryEvidence,
} from '../functions/lib/period-boundary-preaggregate.js';
import {
  loadPeriodBoundaryEvidence,
  preaggregatedPeriodBoundaryEvidenceSql,
} from '../functions/lib/period-boundary-evidence.js';

function fakeStatement(sql, calls) {
  return {
    sql,
    params: [],
    bind(...params) { this.params = params; return this; },
    async run() { calls.push({ sql: this.sql, params: this.params }); return { meta: { changes: 1 } }; },
    async all() {
      calls.push({ sql: this.sql, params: this.params });
      return {
        results: [{
          period_key: '2026-07-25',
          boundary_start_at: Date.UTC(2026, 6, 25),
          boundary_end_at: Date.UTC(2026, 6, 26),
          stream_start: 100,
          stream_end: 120,
          member_start: 10,
          member_end: 11,
          has_start: 1,
          has_end: 1,
        }],
      };
    },
  };
}

test('snapshot boundary candidates cover both sides of a UTC boundary', () => {
  const midnight = Date.UTC(2026, 6, 26);
  const candidates = periodBoundaryCandidates(midnight);
  assert.equal(candidates.some((row) => row.mode === 'daily'
    && row.period_key === '2026-07-26' && row.boundary_name === 'start'), true);
  assert.equal(candidates.some((row) => row.mode === 'daily'
    && row.period_key === '2026-07-25' && row.boundary_name === 'end'), true);
});

test('snapshot ingest writes only compact boundary evidence rows', async () => {
  const calls = [];
  const db = {
    prepare(sql) { return fakeStatement(sql, calls); },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const result = await savePeriodBoundaryEvidence(db, Date.UTC(2026, 6, 26), {
    current_stream_count: 120,
    total_member_count: 11,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.written > 0, true);
  assert.equal(calls.every(({ sql }) => sql.includes('sh_period_boundary_evidence')), true);
});

test('period boundary reads use the preaggregated table without scanning snapshots', async () => {
  const calls = [];
  const db = { prepare(sql) { return fakeStatement(sql, calls); } };
  const evidence = await loadPeriodBoundaryEvidence(db, [{ period_key: '2026-07-25' }], 'daily');
  assert.equal(evidence.get('2026-07-25').stream_end, 120);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sh_period_boundary_evidence/);
  assert.doesNotMatch(calls[0].sql, /sh_channel_snapshots/);
  assert.match(preaggregatedPeriodBoundaryEvidenceSql(), /GROUP BY periods\.period_key/);
});

test('history summaries read compact boundary evidence from the buddies DB', () => {
  const summary = readFileSync(
    new URL('../functions/lib/history-summary.js', import.meta.url),
    'utf8',
  );
  assert.match(summary, /loadPeriodBoundaryEvidence\(env\.DB \|\| loaded\.sourceDb/);
  assert.doesNotMatch(summary, /loadPeriodBoundaryEvidence\(loaded\.sourceDb \|\| env\.DB/);
});

test('migration and metadata ingest enforce compact change-only writes', () => {
  const migration = readFileSync(
    new URL('../../database/buddies-migrations/011_period_boundary_evidence.sql', import.meta.url),
    'utf8',
  );
  const ingest = readFileSync(new URL('../functions/lib/ingest.js', import.meta.url), 'utf8');
  assert.match(migration, /PRIMARY KEY \(mode, period_key, boundary_name\)/);
  assert.match(ingest, /savePeriodBoundaryEvidence/);
  assert.match(ingest, /ON CONFLICT\(spotify_id\) DO UPDATE SET/);
  assert.match(ingest, /excluded\.source IS NOT sh_track_metadata\.source/);
  assert.match(ingest, /Array\.isArray\(batchResult\)/);
  assert.match(ingest, /: statements\.length/);
});
