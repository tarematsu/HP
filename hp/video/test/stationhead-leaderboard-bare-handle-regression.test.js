import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collector = readFileSync(
  new URL('../../native/src/stationhead_leaderboard_collector.cpp', import.meta.url),
  'utf8',
);

function parseLeaderboardHandle(line) {
  const match = line.match(/^@?([A-Za-z0-9_.-]{1,80})$/);
  return match && !/^\d+$/.test(match[1]) ? match[1] : null;
}

test('leaderboard collector accepts the bare handles rendered by Stationhead', () => {
  assert.ok(collector.includes('match(/^@?([A-Za-z0-9_.-]{1,80})$/)'));
  assert.ok(collector.includes('!/^\\d+$/.test(match[1])'));

  assert.equal(parseLeaderboardHandle('sixtonessme'), 'sixtonessme');
  assert.equal(parseLeaderboardHandle('@sakurazaka46jp'), 'sakurazaka46jp');
  assert.equal(parseLeaderboardHandle('21'), null);
});
