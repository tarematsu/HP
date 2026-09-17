import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const loader = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const cloudSync = readFileSync(
  new URL('../../native/src/cloud_client_sync.cpp', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');
const randomCatalog = readFileSync(
  new URL('../../cloud/src/spotify_random_catalog.ts', import.meta.url), 'utf8');

test('Spotify watches the same device config cache replaced by CloudClient sync', () => {
  assert.match(cloudSync, /deviceConfigPath = dataDir_ \/ L"device-config\.json"/);
  assert.match(cloudSync, /StringPayload\(root, L"deviceConfig"\)/);
  assert.match(cloudSync, /AtomicWriteBytes\(deviceConfigPath, \*payload\)/);
  assert.match(loader, /kSpotifyCloudConfigFile\[\] = L"device-config\.json"/);
  assert.match(loader, /fs::last_write_time\(path, timeError\)/);
  assert.match(schedule, /RunStaggeredReconcile\(\)[\s\S]*EnsureCloudPlaylistLoaded\(\)/);
});

test('natural scheduler wakes throttle synchronized playlist cache checks', () => {
  const startAt = schedule.indexOf('void SpotifyWebViews::StartAutonomousSchedule');
  const runAt = schedule.indexOf('void SpotifyWebViews::RunStaggeredReconcile');
  assert.ok(startAt >= 0 && runAt > startAt);
  const start = schedule.slice(startAt, runAt);
  const run = schedule.slice(runAt);

  assert.doesNotMatch(start, /EnsureCloudPlaylistLoaded\(\)/);
  assert.match(schedule, /kSpotifyCloudReloadMinIntervalMs = 60ULL \* 1000ULL/);
  assert.match(header, /ULONGLONG nextCloudPlaylistCheckTick_ = 0/);
  assert.match(start, /nextCloudPlaylistCheckTick_ = 0/);
  assert.match(run, /const bool cloudPlaylistReady = InitialCloudPlaylistReady\(now\)/);
  assert.match(
    run,
    /if \(!cloudPlaylistWasReady && cloudPlaylistReady\) \{[\s\S]*nextCloudPlaylistCheckTick_ = now \+ kSpotifyCloudReloadMinIntervalMs/,
  );
  assert.match(
    run,
    /else if \(cloudPlaylistWasReady && cloudPlaylistReady &&[\s\S]*nextCloudPlaylistCheckTick_ == 0 \|\|[\s\S]*now >= nextCloudPlaylistCheckTick_[\s\S]*EnsureCloudPlaylistLoaded\(\);[\s\S]*nextCloudPlaylistCheckTick_ = now \+ kSpotifyCloudReloadMinIntervalMs/,
  );
  assert.equal((run.match(/EnsureCloudPlaylistLoaded\(\)/g) ?? []).length, 1);
  assert.match(loader, /if \(initialCloudPlaylistReady_\) EnsureCloudPlaylistLoaded\(\)/);
  assert.doesNotMatch(phase, /nextCloudPlaylistCheckTick_|kSpotifyCloudReloadMinIntervalMs/);
});

test('device config cache identity/version mismatch forces a full cloud refresh', () => {
  assert.match(cloudSync, /const auto requestedDeviceConfigVersion = \[&\]\(\)/);
  assert.match(cloudSync, /GetNamedNumber\(L"version", -1\.0\)/);
  assert.match(cloudSync, /GetNamedString\(L"deviceId", L""\)/);
  assert.match(cloudSync, /static_cast<int>\(version\) != deviceConfigVersion_/);
  assert.match(cloudSync, /deviceId != config_\.deviceId/);
  assert.match(cloudSync, /GetNamedValue\(L"config"\)\.ValueType\(\) != JsonValueType::Object/);
  assert.match(cloudSync, /forcing refresh/);
  assert.match(cloudSync, /L"&configVersion=" \+[\s\S]*requestedDeviceConfigVersion\(\)/);
});

test('temporary cache absence keeps the last synchronized Spotify settings', () => {
  assert.match(loader, /if \(cloudPlaylistLoaded_\)[\s\S]*if \(!fileAvailable\) return/);
  assert.match(header, /cloudPlaylistWriteTimeKnown_ = false/);
  assert.match(header, /cloudPlaylistWriteTime_/);
});

test('only Spotify rotation changes advance the rotation revision', () => {
  assert.match(header, /cloudRotationFingerprint_/);
  assert.match(header, /cloudRotationRevision_ = 1/);
  assert.match(header, /timedCloudRotationRevision = 0/);
  assert.match(loader, /nextRotationFingerprint = rotation\.Stringify\(\)\.c_str\(\)/);
  assert.match(loader, /if \(!rotationChanged\) return;[\s\S]*\+\+cloudRotationRevision_/);
  assert.doesNotMatch(header + loader, /cloudPodcastFingerprint|nextPodcastFingerprint/);
});

test('a synchronized rotation starts at the next natural completion boundary without replaying the completed path', () => {
  const advanceStart = rotation.indexOf('void SpotifyWebViews::AdvanceTimedRotationSlot');
  const advanceEnd = rotation.indexOf('void SpotifyWebViews::ProbeDueTimedCompletions', advanceStart);
  assert.ok(advanceStart >= 0 && advanceEnd > advanceStart);
  const advance = rotation.slice(advanceStart, advanceEnd);
  assert.match(advance, /std::wstring completedPath/);
  assert.match(advance, /timedCloudRotationRevision != cloudRotationRevision_/);
  assert.match(advance, /timedRotationPosition = 0[\s\S]*PrepareTimedRotationCycle\(slot\)[\s\S]*timedCloudRotationRevision = cloudRotationRevision_/);
  assert.match(
    advance,
    /timedCycleTracks\[slot\.timedRotationPosition\]\.path == completedPath[\s\S]*std::find_if\([\s\S]*track\.path != completedPath[\s\S]*timedRotationPosition = static_cast<size_t>/,
  );
  assert.ok(
    advance.indexOf('timedCloudRotationRevision != cloudRotationRevision_') <
      advance.indexOf('++slot.timedRotationPosition'),
  );
  assert.doesNotMatch(rotation + schedule, /AdvanceExpiredTimedRotation|kSpotifyMusicTrackDeadlineMs/);
});

test('Spotify sync handling contains no podcast feature path', () => {
  const source = header + loader + schedule + rotation + admin + randomCatalog;
  assert.doesNotMatch(
    source,
    /TalkAbout|TALKABOUT|talkAbout|includeTalkAbout|SpotifyPodcast|podcastBreakActive/,
  );
});

test('admin exposes the shared seven-group managed rotation', () => {
  assert.match(admin, /端末への反映は次回クラウド同期時です/);
  assert.match(admin, /次回クラウド同期でSpotify設定を反映します/);
  assert.match(admin, /managedSpotifySevenSlotRotation/);
  assert.match(admin, /MANAGED_SPOTIFY_RANDOM_TRACK_IDS/);
  assert.match(admin, /managedSpotifyRotation/);
  assert.match(admin, /managedRandomPool/);
  assert.match(randomCatalog, /SPOTIFY_B_ROTATION_TRACKS/);
  assert.match(randomCatalog, /ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS/);
  assert.equal((randomCatalog.match(/tracks: instrumentalSongs\.map/g) ?? []).length, 2);
  assert.equal((randomCatalog.match(/tracks: shortSongs\.map/g) ?? []).length, 3);
});
