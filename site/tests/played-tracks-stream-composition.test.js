import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shell = browserSource('stationhead-channel-shell.js');
const tabs = dashboardRouterSource();

test('played tracks view does not load the retired estimated stream composition chart', () => {
  const panel=browserSource('stationhead-channel-shell.js').split('data-stationhead-panel="played-tracks"')[1].split('data-stationhead-panel="likes"')[0]; assert.doesNotMatch(panel,/平均同接|推定再生数/); assert.match(panel,/played-chart/); assert.doesNotMatch(browserSource('stationhead/played-tracks.js'),/estimated|streamComposition/);
});

test('retired estimated stream chart has no dedicated D1-backed API route', () => {
  assert.equal(existsSync(new URL('../functions/api/played-track-streams.js', import.meta.url)), false);
});
