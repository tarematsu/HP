import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scheduleTimes } from '../src/official-news-html.js';
import { DECODE_STATION_MAIN_SQL } from '../src/official-news-probe.js';
import { officialNewsConfig } from '../src/official-news-utils.js';

const JST_22 = Date.UTC(2026, 6, 26, 13, 0, 0);

test('Japanese hour notation defines the exact minute collection start', () => {
  assert.deepEqual(
    scheduleTimes('2026年7月26日 22時からStationhead配信', 2026, '2026-07-26'),
    [JST_22],
  );
  assert.deepEqual(
    scheduleTimes('Stationheadは22時から配信予定', 2026, '2026-07-26'),
    [JST_22],
  );
});

test('official news keeps hourly discovery while raw collection starts at the exact minute', () => {
  const config = officialNewsConfig({ OFFICIAL_NEWS_EARLY_WINDOW_MS: 0 });
  assert.equal(config.earlyWindowMs, 0);
  assert.equal(config.checkIntervalMs, 60 * 60 * 1000);
  assert.equal(config.endConfirmPolls, 2);
});

test('main response decoding is delegated to D1 JSON functions', () => {
  assert.match(DECODE_STATION_MAIN_SQL, /json_valid\(raw_json\)/);
  assert.match(DECODE_STATION_MAIN_SQL, /json_extract\(raw_json,'\$\.is_broadcasting'\)/);
  assert.match(DECODE_STATION_MAIN_SQL, /json_extract\(raw_json,'\$\.broadcast\.id'\)/);
});

test('main and chat save stages persist response text without Worker JSON processing', () => {
  const source = readFileSync(new URL('../src/official-news-probe.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /response\.json\(/);

  const main = source.slice(
    source.indexOf('export async function collectStationMain'),
    source.indexOf('export async function decodeStationMain'),
  );
  const chat = source.slice(
    source.indexOf('export async function collectStationChat'),
    source.indexOf('function probeStatement'),
  );
  assert.doesNotMatch(main, /JSON\.(?:parse|stringify)|json_(?:valid|extract)/);
  assert.doesNotMatch(chat, /JSON\.(?:parse|stringify)|json_(?:valid|extract)/);
  assert.match(main, /rawText/);
  assert.match(chat, /rawText/);
  assert.match(main, /sh_sakurazaka46jp_main/);
  assert.match(chat, /sh_sakurazaka46jp_chat/);
});

test('authentication, raw saves, D1 decode, chat save, and finalization are separate Queue stages', () => {
  const source = readFileSync(new URL('../src/other-official-news-stages.js', import.meta.url), 'utf8');
  for (const stage of ['station-auth', 'station-main', 'station-decode', 'station-chat', 'station-finalize']) {
    assert.match(source, new RegExp(`['"]${stage}['"]`));
  }
});

test('HP migration 016 owns minute raw tables', () => {
  const migration = readFileSync(
    new URL('../../database/other-migrations/016_sakurazaka46jp_raw_collection.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_main/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_chat/);
  assert.match(migration, /raw_json TEXT NOT NULL/);
});
