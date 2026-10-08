import assert from 'node:assert/strict';
import test from 'node:test';
import { claimStationheadAuthRefresh, finishStationheadAuthRefresh } from '../src/stationhead-auth-control.js';

test('shared auth SQL honors source-specific lock and optional lower-priority cooldown', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      };
    },
  };
  assert.equal(await claimStationheadAuthRefresh(db, { now: 1000, lockMs: 200 }), true);
  assert.equal(calls[0].args.length, 5);
  assert.doesNotMatch(calls[0].sql, /last_attempt_at,0\)<=\?/);
  assert.equal(await claimStationheadAuthRefresh(db, { now: 1000, cooldownMs: 300 }), true);
  assert.deepEqual(calls[1].args, [61_000, 1000, 1000, 'stationhead', 1000, 700]);
  assert.match(calls[1].sql, /COALESCE\(last_attempt_at,0\)<=\?/);
  await finishStationheadAuthRefresh(db, { now: 2000, error: 'temporary' });
  assert.deepEqual(calls[2].args, ['temporary', 2000, 'temporary', 2000, 'stationhead']);
});
