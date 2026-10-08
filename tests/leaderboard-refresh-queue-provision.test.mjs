import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureLeaderboardRefreshQueue } from '../.github/scripts/ensure-leaderboard-refresh-queue.mjs';
test('deployment creates the refresh queue or accepts an existing queue only', () => {
  const calls = [];
  ensureLeaderboardRefreshQueue(args => calls.push(args));
  assert.deepEqual(calls, [['queues', 'create', 'stationhead-leaderboard-refresh']]);
  ensureLeaderboardRefreshQueue(() => { throw new Error('Queue already exists'); });
  ensureLeaderboardRefreshQueue(() => { throw new Error("Queue name 'stationhead-leaderboard-refresh' is already taken. [code: 11009]"); });
  assert.throws(() => ensureLeaderboardRefreshQueue(() => { throw new Error('permission denied'); }), /permission denied/);
});
