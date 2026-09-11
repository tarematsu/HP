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
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');

test('cloud owns the requested seven-position Spotify rotation', () => {
  assert.match(catalog, /function managedSpotifySevenSlotRotation/);
  assert.match(catalog, /Lonesome Rabbit/);
  assert.match(catalog, /放課後BitterBlue/);
  assert.match(catalog, /SPOTIFY_B_ROTATION_TRACKS/);
  assert.match(catalog, /ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS/);
  assert.match(catalog, /shortSongs\.map/);
  assert.match(catalog, /includeTalkAbout: true/);
  assert.match(admin, /rotation:structuredClone\(managedSpotifyRotation\)/);
  assert.match(deviceSync, /spotify\.rotation = managedSpotifySevenSlotRotation\(\)/);
});

test('B slot contains the requested five Spotify tracks', () => {
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

test('C slot includes Overture and all seven Interludes', () => {
  assert.match(catalog, /Overture/);
  for (let index = 1; index <= 7; ++index) {
    assert.match(catalog, new RegExp(`Interlude #${index}`));
  }
});

test('native enforces no duplicate Spotify path inside one cycle', () => {
  assert.match(recent, /std::vector<std::wstring> usedPaths/);
  assert.match(recent, /std::find\(usedPaths\.begin\(\), usedPaths\.end\(\), track\.path\)/);
  assert.match(recent, /usedPaths\.push_back\(track\.path\)/);
  assert.match(recent, /size_t appended = 0/);
  assert.match(recent, /if \(!appendUnique\(std::move\(candidate\)\)\) continue/);
});

test('G mixes the short-song pool with latest TALKABOUT and disables the old interrupt', () => {
  assert.match(header, /bool includeTalkAbout = false/);
  assert.match(header, /bool inlineTalkAboutRotation_ = false/);
  assert.match(cloud, /GetNamedBoolean\(L"includeTalkAbout", false\)/);
  assert.match(recent, /if \(group\.includeTalkAbout\)/);
  assert.match(recent, /SpotifyPodcastTargetReady\(\)/);
  assert.match(recent, /SpotifyPodcastUrl\(\)/);
  assert.match(recent, /SpotifyPodcastPath\(\)/);
  assert.match(rotation, /if \(inlineTalkAboutRotation_\) return false/);
  assert.match(rotation, /target\.path == SpotifyPodcastPath\(\)/);
  assert.match(rotation, /TimedSpotifyTarget::TalkAbout/);
});
