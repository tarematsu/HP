import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../cloud/src/spotify_random_catalog.ts', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(
  new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const cycle = readFileSync(
  new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');

test('cloud owns the requested seven-group Spotify rotation', () => {
  assert.match(catalog, /function managedSpotifySevenSlotRotation/);
  assert.match(catalog, /Lonesome Rabbit/);
  assert.match(catalog, /放課後BitterBlue/);
  assert.match(catalog, /紋白蝶が確か飛んでた/);
  assert.match(catalog, /6VIY7OFy8g5ZyLSgQEi8lV/);
  assert.match(catalog, /SPOTIFY_B_ROTATION_TRACKS/);
  assert.match(catalog, /ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS/);
  assert.match(catalog, /SHORT_SPOTIFY_ROTATION_TRACKS/);

  const rotationFunction = catalog.slice(
    catalog.indexOf('export function managedSpotifySevenSlotRotation()'),
  );
  assert.equal((rotationFunction.match(/mode: /g) ?? []).length, 7);
  assert.equal((rotationFunction.match(/tracks: instrumentalSongs\.map/g) ?? []).length, 2);
  assert.equal((rotationFunction.match(/tracks: shortSongs\.map/g) ?? []).length, 2);
  assert.match(
    rotationFunction,
    /mode: "random",\s*count: 1,\s*tracks: \[\s*spotifyRotationTrack\("放課後BitterBlue"[\s\S]*spotifyRotationTrack\("紋白蝶が確か飛んでた"/,
  );

  assert.match(admin, /rotation:structuredClone\(managedSpotifyRotation\)/);
  assert.match(deviceSync, /const nextRotation = managedSpotifySevenSlotRotation\(\)/);
  assert.match(deviceSync, /spotify\.rotation = nextRotation/);
});

test('C slot contains the requested five Spotify tracks', () => {
  for (const id of [
    '33liCluqUasE65nMv3KLLm',
    '5QnQ7m9OxSoFeSPSz8grqX',
    '2ze5Hu3eRRe6HxJTfuZaA0',
    '2CMSkSwIfnNQR7bTNFFeB5',
    '2meBhRDzQpf0ltQH11HbWG',
  ]) assert.match(catalog, new RegExp(id));
  for (const title of [
    'KAZOKU', 'コインランドリー', 'We got your back', '各駅停車', '恵まれ過ぎて',
  ]) assert.match(catalog, new RegExp(title));
});

test('B and E share Overture plus all seven Interludes', () => {
  assert.match(catalog, /Overture/);
  for (let index = 1; index <= 7; ++index) {
    assert.match(catalog, new RegExp(`Interlude #${index}`));
  }
  assert.equal(
    (catalog.match(/tracks: instrumentalSongs\.map/g) ?? []).length,
    2,
  );
});

test('short-song pool includes every verified short OFF VOCAL track', () => {
  assert.match(
    catalog,
    /SHORT_SPOTIFY_ROTATION_TRACKS\s*=\s*\[\s*\.\.\.SHORT_SPOTIFY_RANDOM_TRACKS,\s*\.\.\.OFF_VOCAL_SPOTIFY_RANDOM_TRACKS,/s,
  );
  assert.match(
    catalog,
    /const shortSongs = rotationTracks\(SHORT_SPOTIFY_ROTATION_TRACKS\)/,
  );
  for (const id of [
    '04nk2Ee7qSnNwn6OG2hl3Q',
    '4hVECXakmpdqigQq1mJwNg',
    '51nXGT2UTljN9BdOgn0Utw',
    '1R5rm05YeYZSJiGzZPZx8l',
    '17PV1rxc1KbMOTRKSRt2hd',
    '54VmTDaOAl0LVlOmYOFuFi',
    '5TaAgmUQuhJw4bGW4dg3KI',
  ]) assert.match(catalog, new RegExp(id));
});

test('short-song pool includes the eleven additional verified vocal tracks', () => {
  assert.match(catalog, /ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS/);
  assert.match(
    catalog,
    /SHORT_SPOTIFY_ROTATION_TRACKS\s*=\s*\[[\s\S]*\.\.\.ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS,/,
  );
  for (const id of [
    '44sj7vChwZRYQ0Oz9AFyP2',
    '5vOABxcejLNdoyLh7JRtjM',
    '3CzKqb5U3GlxUhoJGv1BZf',
    '7jLbrfs3YtWO232XEU3iD1',
    '5z8xkccoi9bnA8SGf2VQnk',
    '6oZVLkbhLB3qyikq0eNlEy',
    '31vLfN5bNOpasgULiqSbLx',
    '37h3M4ZYJgSRy0cXArsH59',
    '59G1ePHebLtol0u5upRFSZ',
    '2K6uY7BaeOfuPwJNOVF3ht',
    '1QidgC1vyuG6053IY5S4UG',
  ]) assert.match(catalog, new RegExp(id));
  assert.match(catalog, /ピッカーン！/);
});

test('native enforces no duplicate Spotify path inside one cycle', () => {
  assert.match(cycle, /std::vector<std::wstring> usedPaths/);
  assert.match(cycle, /std::find\(usedPaths\.begin\(\), usedPaths\.end\(\), track\.path\)/);
  assert.match(cycle, /usedPaths\.push_back\(track\.path\)/);
  assert.match(cycle, /size_t appended = 0/);
  assert.match(cycle, /if \(!appendUnique\(std::move\(candidate\)\)\) continue/);
});

test('F and G use the same short-song music pool and no podcast path remains', () => {
  assert.equal((catalog.match(/tracks: shortSongs\.map/g) ?? []).length, 2);
  const spotifySources = catalog + admin + deviceSync + header + cloud + cycle + rotation + schedule;
  assert.doesNotMatch(
    spotifySources,
    /TalkAbout|TALKABOUT|talkAbout|includeTalkAbout|SpotifyPodcast|podcastBreakActive/,
  );
});
