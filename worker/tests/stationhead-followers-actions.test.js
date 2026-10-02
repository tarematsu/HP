import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXED_FOLLOWER_HANDLES,
  buildFollowerReadModel,
  createStationheadGuestSession,
  normalizeFollowerHandle,
  normalizeFollowerTargets,
} from '../scripts/collect-stationhead-followers-actions.mjs';

test('Actions follower collector rejects polluted Stationhead handles', () => {
  assert.equal(normalizeFollowerHandle(' SakuraMankai '), 'sakuramankai');
  assert.equal(normalizeFollowerHandle('<html lang='), '');
  assert.equal(normalizeFollowerHandle('計算上の再生数'), '');
  assert.equal(normalizeFollowerHandle('buddy46'), '');
});

test('Actions follower targets always include fixed handles and merge valid source masks', () => {
  const result = normalizeFollowerTargets([
    { handle: 'sakuramankai', source_mask: 2 },
    { handle: 'hinatapr0211', source_mask: 4 },
    { handle: 'HINATAPR0211', source_mask: 2 },
    { handle: '<html lang=', source_mask: 2 },
    { handle: 'buddy46', source_mask: 4 },
  ]);
  assert.deepEqual(result.targets.slice(0, 4).map((row) => row.handle), FIXED_FOLLOWER_HANDLES);
  assert.equal(result.targets.find((row) => row.handle === 'sakuramankai').source_mask, 3);
  assert.equal(result.targets.find((row) => row.handle === 'hinatapr0211').source_mask, 6);
  assert.equal(result.ignored, 2);
});

test('Actions follower read model calculates deltas and affiliations from daily D1 rows', () => {
  const model = buildFollowerReadModel({
    historyRows: [
      { observed_date_jst: '2026-10-02', followers_json: JSON.stringify({ sakuramankai: 4282, hinatapr0211: 100 }) },
      { observed_date_jst: '2026-10-03', followers_json: JSON.stringify({ sakuramankai: 4283, hinatapr0211: 103 }) },
    ],
    targets: [
      { handle: 'sakuramankai', source_mask: 1 },
      { handle: 'hinatapr0211', source_mask: 4 },
    ],
    latestDate: '2026-10-03',
    updatedAt: 12345,
  });
  assert.equal(model.latest_date, '2026-10-03');
  assert.equal(model.accounts.find((row) => row.handle === 'sakuramankai').previous_day_delta, 1);
  assert.equal(model.accounts.find((row) => row.handle === 'hinatapr0211').previous_day_delta, 3);
  assert.deepEqual(model.memberships.hinatapr0211, { affiliation: 'Ohisama', group: 'hinatazaka46' });
});

test('Actions follower auth uses production Stationhead guest endpoints', async () => {
  const calls = [];
  const session = await createStationheadGuestSession({
    fetchFn: async (url, options) => {
      calls.push([String(url), options.method]);
      if (String(url).endsWith('/web/token')) {
        return new Response(null, { status: 204, headers: { authorization: 'Bearer test-token' } });
      }
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(session.token, 'test-token');
  assert.equal(typeof session.deviceUid, 'string');
  assert.deepEqual(calls.map(([url]) => url), [
    'https://production1.stationhead.com/web/token',
    'https://production1.stationhead.com/web/guest/login',
  ]);
});
