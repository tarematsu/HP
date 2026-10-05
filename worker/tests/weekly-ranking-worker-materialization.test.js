import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeWeeklyRankingReadModel } from '../src/weekly-ranking-materializer.js';

test('event-driven generation publishes its in-memory model without DDL or pointer reads', async () => {
  const queries = [];
  let writes;
  const db = {
    prepare(sql) {
      queries.push(sql);
      const statement = {
        bind(...args) { this.args = args; return this; },
        async all() {
          return { results: sql.includes('FROM sh_channel_rankings') ? [{
            ranking_date: '2026-10-05', host_name: 'sakuramankai', rank: 1,
          }] : [] };
        },
        first() { throw new Error('unnecessary pointer read'); },
        run() { throw new Error('unnecessary schema write'); },
      };
      return statement;
    },
    async batch(statements) { writes = statements; },
  };
  const result = await materializeWeeklyRankingReadModel(db, 1791205200000, {
    force: true, initialize: false, includeModel: true,
  });
  assert.equal(result.status, 'materialized');
  assert.equal(result.model.actual_rows[0].rank, 1);
  assert.equal(queries.filter(sql => /^SELECT/.test(sql)).length, 3);
  assert.ok(!queries.some(sql => /CREATE TABLE/.test(sql)));
  const stored = writes.filter(s => s.args?.length === 4).map(s => s.args[2]).join('');
  assert.deepEqual(JSON.parse(stored), result.model);
});
