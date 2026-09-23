import assert from 'node:assert/strict';
import test from 'node:test';

import { importLeaderboardArtifact } from '../scripts/import-stationhead-weekly-leaderboard-actions.mjs';

function statement(sql, bindings = []) {
  return {
    sql,
    bindings,
    bind(...values) {
      return statement(sql, values);
    },
    async all() {
      if (!/^SELECT raw_json\s+FROM sh_channel_rankings/i.test(sql.trim())) {
        throw new Error(`unexpected all SQL: ${sql}`);
      }
      return { results: [] };
    },
  };
}

test('100-row leaderboard import uses script instead of oversized remote batch', async () => {
  const calls = { script: 0, batch: 0, statements: [] };
  const db = {
    prepare(sql) {
      return statement(sql);
    },
    async script(statements) {
      calls.script += 1;
      calls.statements = statements;
      return { success: true, results: [], meta: {} };
    },
    async batch() {
      calls.batch += 1;
      throw new Error('large leaderboard import must not use batch');
    },
  };

  const observedAt = Date.parse('2026-09-21T15:30:00Z');
  const ranking = Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    name: `channel${String(index + 1).padStart(3, '0')}`,
    streams: 100_000 - index,
    days: 7,
  }));
  const artifact = {
    version: 1,
    available: true,
    digest: 'digest-100-rows',
    records: [{
      observed_at: observedAt,
      source: 'dom',
      page: 'https://www.stationhead.com/leaderboard',
      url: 'https://www.stationhead.com/leaderboard',
      method: 'GET',
      status: 200,
      content_type: 'application/json',
      body: JSON.stringify({
        schema: 2,
        captured_at: observedAt,
        path: '/leaderboard',
        signed_in: true,
        leaderboard_ready: true,
        ranking,
      }),
    }],
  };

  const result = await importLeaderboardArtifact(artifact, db, 123);

  assert.equal(result.status, 'imported');
  assert.equal(result.row_count, 100);
  assert.equal(calls.script, 1);
  assert.equal(calls.batch, 0);
  assert.equal(calls.statements.length, 101);
  assert.match(calls.statements[0].sql, /^DELETE FROM sh_channel_rankings/i);
  assert.match(calls.statements.at(-1).sql, /^INSERT INTO sh_channel_rankings/i);
});
