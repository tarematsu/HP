import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withMinuteD1WriteThrottling } from '../src/minute-d1-write-throttle.js';

const fastStore = readFileSync(
  new URL('../src/minute-facts-fast-store.js', import.meta.url),
  'utf8',
);

const HOST_ALIAS = `INSERT INTO sh_host_aliases(
  alias_type,alias_value,host_id,first_seen_at,last_seen_at
) VALUES(?,?,?,?,?) ON CONFLICT(alias_type,alias_value) DO UPDATE SET
  last_seen_at=MAX(sh_host_aliases.last_seen_at,excluded.last_seen_at)`;

test('every optimized minute fact write installs the D1 throttle before the budget wrapper', () => {
  assert.match(
    fastStore,
    /saveMinuteFactWithinBudget\(\s*withMinuteD1WriteThrottling\(env\),\s*input,\s*saveOptimizedLiveMinuteFact/,
  );
});

test('the throttle rewrites inline host alias timestamp updates to twenty-minute checkpoints', async () => {
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

  const env = withMinuteD1WriteThrottling({ MINUTE_DB: db });
  await env.MINUTE_DB.prepare(HOST_ALIAS)
    .bind('handle', 'host', 7, 1_000, 1_000)
    .run();

  assert.equal(prepared.length, 1);
  assert.match(
    prepared[0],
    /excluded\.last_seen_at-COALESCE\(sh_host_aliases\.last_seen_at,0\)>=1200000/,
  );
});
