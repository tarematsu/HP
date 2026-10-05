import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();

test('played tracks view does not load the retired estimated stream composition chart', () => {
  assert.doesNotMatch(shell, /日別推定再生数（曲別）/);
  assert.doesNotMatch(shell, /playedTracksStream/);
  assert.doesNotMatch(shell, /played-tracks-stream-composition/);
  assert.doesNotMatch(shell, /limit=20000/);
  assert.doesNotMatch(shell, /平均同接/);
  assert.doesNotMatch(shell, /data-view="stream|data-view="streams/);
  assert.match(tabs, /selectStationheadChannelSection/);
  assert.equal(existsSync(new URL('../public/played-tracks-stream-composition.js', import.meta.url)), false);
});

test('retired estimated stream chart has no dedicated D1-backed API route', () => {
  assert.equal(existsSync(new URL('../functions/api/played-track-streams.js', import.meta.url)), false);
});
