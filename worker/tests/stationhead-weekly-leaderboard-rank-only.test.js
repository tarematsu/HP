import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLeaderboardSnapshot } from '../scripts/import-stationhead-weekly-leaderboard-actions.mjs';

test('parses rank-only structured Stationhead weekly leaderboard', () => {
  const parsed = parseLeaderboardSnapshot({
    ranking: [
      { rank: 1, handle: 'sakanactionjp' },
      { rank: 31, handle: 'sakurazaka46jp' },
      { rank: 52, handle: 'sakuramankai' },
    ],
  });

  assert.equal(parsed?.parser, 'direct-ranking');
  assert.deepEqual(parsed?.rows, [
    { rank: 1, channel_name: 'sakanactionjp', channel_alias: 'sakanactionjp', streams: null, days: null },
    { rank: 31, channel_name: 'sakurazaka46jp', channel_alias: 'sakurazaka46jp', streams: null, days: null },
    { rank: 52, channel_name: 'sakuramankai', channel_alias: 'sakuramankai', streams: null, days: null },
  ]);
});
