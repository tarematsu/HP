import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('raw-derived materialization is a separate Queue stage after every collected minute', () => {
  const source = readFileSync(new URL('../src/other-official-news-stages.js', import.meta.url), 'utf8');
  for (const stage of [
    'station-auth', 'station-main', 'station-decode', 'station-chat',
    'station-finalize', 'raw-materialize',
  ]) {
    assert.match(source, new RegExp(`['"]${stage}['"]`));
  }
  assert.match(source, /runStationFinalize[\s\S]*sendStage\(env, 'raw-materialize'/);
});

test('raw materializer reads saved raw only and performs no Stationhead fetch', () => {
  const source = readFileSync(new URL('../src/sakurazaka-raw-materializer.js', import.meta.url), 'utf8');
  assert.match(source, /FROM sh_sakurazaka46jp_main/);
  assert.match(source, /FROM sh_sakurazaka46jp_chat/);
  assert.match(source, /solo_station_snapshot/);
  assert.match(source, /solo_queue/);
  assert.match(source, /solo_comments/);
  assert.doesNotMatch(source, /\bfetch\s*\(|stationRequest|\/guest|chatHistory\?/);
  assert.equal(existsSync(new URL('../src/sakurazaka-monitor.js', import.meta.url)), false);
});

test('raw-derived queue normalization preserves Buddies-equivalent track fields', () => {
  const source = readFileSync(new URL('../src/cloud-host-monitor-normalize.js', import.meta.url), 'utf8');
  for (const field of [
    'spotify_id', 'apple_music_id', 'deezer_id', 'isrc', 'duration_ms', 'preview_url',
    'bite_count', 'title', 'artist', 'album_name', 'thumbnail_url',
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
});

test('HP migrations own minute raw tables and derived track metadata', () => {
  const rawMigration = readFileSync(
    new URL('../../database/other-migrations/016_sakurazaka46jp_raw_collection.sql', import.meta.url),
    'utf8',
  );
  assert.match(rawMigration, /CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_main/);
  assert.match(rawMigration, /CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_chat/);
  assert.match(rawMigration, /raw_json TEXT NOT NULL/);

  const derivedMigration = readFileSync(
    new URL('../../database/other-migrations/017_sakurazaka_raw_derived_metadata.sql', import.meta.url),
    'utf8',
  );
  for (const column of ['title', 'artist', 'album_name', 'thumbnail_url']) {
    assert.match(derivedMigration, new RegExp(`ADD COLUMN ${column} TEXT`));
  }
});
