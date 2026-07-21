import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/liveness-monitor.js', import.meta.url), 'utf8');

test('one-video liveness acquires state, lock, and missing snapshot in one D1 statement', () => {
  assert.match(source, /UPDATE video_liveness_state[\s\S]*SET lock_token = \?[\s\S]*base_upper_id = CASE[\s\S]*death_upper_key = CASE[\s\S]*RETURNING phase/);
  assert.match(source, /const acquired = await acquireRunState\(env\.DB\)/);
  assert.doesNotMatch(source, /async function preparePhase/);
  assert.doesNotMatch(source, /await readState\(env\.DB\)/);
});

test('phase transitions initialize the next snapshot in their existing D1 update', () => {
  assert.match(source, /SET phase = 'death'[\s\S]*death_upper_key = \$\{DEATH_UPPER_KEY_SQL\}[\s\S]*RETURNING death_upper_key AS deathUpperKey/);
  assert.match(source, /SET phase = 'base'[\s\S]*base_upper_id = \$\{BASE_UPPER_ID_SQL\}[\s\S]*RETURNING base_upper_id AS baseUpperId, cycle/);
});

test('one-video liveness bundle contains no worker pool or unused standalone status reader', () => {
  assert.doesNotMatch(source, /mapWithConcurrency/);
  assert.doesNotMatch(source, /getLivenessStatus/);
  assert.doesNotMatch(source, /SELECT COUNT\(\*\) AS count FROM video_death_list/);

  const run = source.slice(source.indexOf('export async function runLivenessMonitor'));
  assert.doesNotMatch(run, /new Set\(/);
  assert.match(run, /const probe = await probeVideoUrl\(row\.mediaUrl\)/);
  assert.match(run, /applyProbeResults\(env\.DB, state\.phase, \[row\], \[probe\]/);
});
