import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const loader = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const cloudSync = readFileSync(
  new URL('../../native/src/cloud_client_sync.cpp', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');

test('Spotify watches the same device config cache replaced by CloudClient sync', () => {
  assert.match(cloudSync, /deviceConfigPath = dataDir_ \/ L"device-config\.json"/);
  assert.match(cloudSync, /StringPayload\(root, L"deviceConfig"\)/);
  assert.match(cloudSync, /AtomicWriteBytes\(deviceConfigPath, \*payload\)/);
  assert.match(loader, /kSpotifyCloudConfigFile\[\] = L"device-config\.json"/);
  assert.match(loader, /fs::last_write_time\(path, timeError\)/);
  assert.match(schedule, /RunStaggeredReconcile\(\)[\s\S]*EnsureCloudPlaylistLoaded\(\)/);
});

test('temporary cache absence keeps the last synchronized Spotify settings', () => {
  assert.match(loader, /if \(cloudPlaylistLoaded_\)[\s\S]*if \(!fileAvailable\) return/);
  assert.match(header, /cloudPlaylistWriteTimeKnown_ = false/);
  assert.match(header, /cloudPlaylistWriteTime_/);
});

test('only Spotify rotation changes advance the rotation revision', () => {
  assert.match(header, /cloudRotationFingerprint_/);
  assert.match(header, /cloudPodcastFingerprint_/);
  assert.match(header, /cloudRotationRevision_ = 1/);
  assert.match(header, /timedCloudRotationRevision = 0/);
  assert.match(loader, /nextRotationFingerprint = rotation\.Stringify\(\)\.c_str\(\)/);
  assert.match(loader, /nextPodcastFingerprint = talkAbout\.Stringify\(\)\.c_str\(\)/);
  assert.match(loader, /if \(rotationChanged\)[\s\S]*\+\+cloudRotationRevision_/);
});

test('a synchronized rotation starts at the next track boundary without cutting the current track', () => {
  const advanceStart = rotation.indexOf('void SpotifyWebViews::AdvanceTimedRotationSlot');
  const advanceEnd = rotation.indexOf('bool SpotifyWebViews::AdvanceExpiredTimedRotation', advanceStart);
  assert.ok(advanceStart >= 0 && advanceEnd > advanceStart);
  const advance = rotation.slice(advanceStart, advanceEnd);
  assert.match(advance, /timedCloudRotationRevision != cloudRotationRevision_/);
  assert.match(advance, /timedRotationPosition = 0[\s\S]*PrepareTimedRotationCycle\(slot\)[\s\S]*timedCloudRotationRevision = cloudRotationRevision_/);
  assert.ok(
    advance.indexOf('timedCloudRotationRevision != cloudRotationRevision_') <
      advance.indexOf('++slot.timedRotationPosition'),
  );
  assert.match(rotation, /InitializeTimedRotationSlot[\s\S]*timedCloudRotationRevision = cloudRotationRevision_/);
  assert.match(rotation, /CompletePodcastBreak[\s\S]*timedCloudRotationRevision = cloudRotationRevision_/);
});

test('TALKABOUT interval shortening is applied on sync without postponing earlier deadlines', () => {
  assert.match(loader, /if \(podcastScheduleLoaded_\)/);
  assert.match(loader, /maxFuture =\s*wallNow \+ static_cast<int64_t>\(podcastIntervalMs_\)/);
  assert.match(loader, /if \(slot\.podcastDueUnixMs > maxFuture\)/);
  assert.doesNotMatch(loader, /slot\.podcastDueUnixMs < maxFuture/);
});

test('admin describes sync-time application rather than restart-time application', () => {
  assert.match(admin, /端末への反映は次回クラウド同期時です/);
  assert.match(admin, /ローテーション変更は次の曲から反映します/);
  assert.match(admin, /次回クラウド同期でSpotify設定を反映します/);
  assert.doesNotMatch(admin, /次回HomePanel再起動時にSpotify設定を適用/);
});
