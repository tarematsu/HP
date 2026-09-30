import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readModel = readFileSync(new URL('../src/nogizaka-read-model.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/nogizaka-entry.js', import.meta.url), 'utf8');
const finalized = readFileSync(new URL('../src/nogizaka-official-news.js', import.meta.url), 'utf8');

test('Nogizaka active broadcasts materialize a minute read model before the realtime tail is served', () => {
  assert.match(readModel, /WHERE a\.status='active'/);
  assert.match(readModel, /series\.refreshed_at<a\.updated_at/);
  assert.match(readModel, /summary\.refreshed_at<a\.updated_at/);
  assert.match(readModel, /ended_at=NULL/);
  assert.match(readModel, /ended_jst=NULL/);
  assert.match(readModel, /stationhead-live:nogizaka46smej/);
  assert.match(readModel, /GROUP BY elapsed_minute ORDER BY elapsed_minute ASC/);
  assert.match(entry, /reconcile: reconcileNogizakaReadModels/);
});

test('Nogizaka reconciliation preserves the existing finalized model pass after live materialization', () => {
  assert.match(readModel, /materializeActiveReadModels\(env, completedAt\)/);
  assert.match(readModel, /reconcileNogizakaOfficialAnnouncements\(env, runStartedAt, completedAt\)/);
  assert.match(finalized, /WHERE a\.status='ended'/);
  assert.match(finalized, /stationhead-finalized:nogizaka46smej/);
  assert.match(finalized, /summary\.ended_at IS NULL/);
});
