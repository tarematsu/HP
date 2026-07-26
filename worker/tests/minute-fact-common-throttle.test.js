import assert from 'node:assert/strict';
import test from 'node:test';

import { saveMinuteFactWithinBudget } from '../src/minute-facts-write-budget.js';

const HOST_ALIAS = `INSERT INTO sh_host_aliases(
  alias_type,alias_value,host_id,first_seen_at,last_seen_at
) VALUES(?,?,?,?,?) ON CONFLICT(alias_type,alias_value) DO UPDATE SET
  last_seen_at=MAX(sh_host_aliases.last_seen_at,excluded.last_seen_at)`;

test('the common minute fact boundary installs D1 checkpoint rewrites for inline writes', async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      prepared.push(sql);
      return {
        bind(...binds) {
          return {
            binds,
            async run() { return { success: true, meta: { changes: 0 } }; },
          };
        },
      };
    },
  };

  await saveMinuteFactWithinBudget({
    MINUTE_DB: db,
    MINUTE_FACT_TIMEOUT_MS: 0,
  }, {}, async (env) => {
    await env.MINUTE_DB.prepare(HOST_ALIAS)
      .bind('handle', 'host', 7, 1_000, 1_000)
      .run();
  });

  assert.equal(prepared.length, 1);
  assert.match(
    prepared[0],
    /excluded\.last_seen_at-COALESCE\(sh_host_aliases\.last_seen_at,0\)>=1200000/,
  );
});
