import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const header = readFileSync(new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const core1 = readFileSync(new URL('../../native/src/spotify_webviews_core_part1.inc', import.meta.url), 'utf8');
const schedule = readFileSync(new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const timed = readFileSync(new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const recent = readFileSync(new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const rotation = readFileSync(new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const scripts = readFileSync(new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const scoped = readFileSync(new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const cloud = readFileSync(new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');

test('Spotify startup keeps one shared 40-second account offset with one direct scheduler', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(wrapper, /#include "spotify_cloud_playlist\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /static_cast<ULONGLONG>\(accountCount\) \* kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.match(schedule, /StaggeredReconcileTimerProc/);
});

test('Spotify schedule starts autonomously and loads cloud playlist before rotation', () => {
  assert.match(header, /scheduleStartTick_ = 0/);
  assert.match(header, /void StartAutonomousSchedule\(ULONGLONG now\) noexcept/);
  assert.match(core1, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /void SpotifyWebViews::StartAutonomousSchedule/);
  assert.match(schedule, /EnsureCloudPlaylistLoaded\(\)[\s\S]*robustSchedulerStarted_ = true/);
  assert.match(schedule, /if \(!slot\.timedRotationActive\)[\s\S]*InitializeTimedRotationSlot\(slot, now\)/);
  assert.doesNotMatch(header + schedule, /podcastMode_|SetPodcastMode|youtubeCycleStartTick_/);
});

test('cloud rotation supports arbitrary fixed, shuffle, and random block lengths', () => {
  assert.match(header, /struct RotationGroup/);
  assert.match(header, /Mode : unsigned char \{ Fixed, Shuffle, Random \}/);
  assert.match(header, /std::vector<ManagedTrack> tracks/);
  assert.match(header, /std::vector<ManagedTrack> timedCycleTracks/);
  assert.match(cloud, /GetNamedArray\(L"rotation"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"fixed"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"shuffle"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"random"\)/);
  assert.match(cloud, /GetNamedNumber\(L"count", 1\.0\)/);
  assert.match(recent, /for \(const RotationGroup& group : cloudRotationGroups_\) appendGroup\(group\)/);
  assert.match(recent, /slot\.timedCycleTracks\.insert/);
  assert.match(recent, /std::swap\(order\[remaining - 1\], order\[swapIndex\]\)/);
  assert.match(recent, /std::min\(group\.count, order\.size\(\)\)/);
  assert.doesNotMatch(rotation, /% 6U|position <= 4U/);
});

test('cycle advances immediately on ended or no later than the shared four-minute deadline', () => {
  assert.match(rotation, /\+\+slot\.timedRotationPosition/);
  assert.match(rotation, /slot\.timedRotationPosition >= slot\.timedCycleTracks\.size\(\)/);
  assert.match(rotation, /PrepareTimedRotationCycle\(slot\)/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /spotify:timed-ended/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(header, /kSpotifyMusicTrackDeadlineMs =\s*4ULL \* 60ULL \* 1000ULL/);
  assert.match(runtime, /spotify:timed-started/);
  assert.match(runtime, /navigator\.mediaSession/);
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /!matchesTarget\(target, identity\)/);
  assert.match(rotation, /timedPlaybackStartTick = GetTickCount64\(\)/);
  assert.match(rotation, /now - slot\.timedPlaybackStartTick < kSpotifyMusicTrackDeadlineMs/);
  assert.match(schedule, /AdvanceExpiredTimedRotation\(now\)/);
});

test('every cloud song shares one native music descriptor and scoped reconcile path', () => {
  assert.match(header, /struct MusicTargetDescriptor/);
  assert.match(recent, /MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget/);
  assert.match(recent, /slot\.timedTarget != TimedSpotifyTarget::Music/);
  assert.match(recent, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(recent, /void SpotifyWebViews::NavigateMusicTarget/);
  assert.match(recent, /void SpotifyWebViews::ReconcileMusicTarget/);
  assert.match(recent, /kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(header + timed + recent, /SlotMatchesTimedTarget|NavigateTimedSlot|ReconcileTimedSlot/);
});

test('stale playback events are rejected by target generation', () => {
  assert.match(header, /ULONGLONG targetGeneration = 0/);
  assert.match(rotation, /ParseSpotifyGenerationEvent/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(recent, /spotify:generation/);
  assert.match(recent, /std::to_wstring\(slot\.targetGeneration\)/);
  assert.match(runtime, /message \+ '\\u001f' \+ generation\(\)/);
});

test('invalid or absent cloud rotation falls back to the former six-song behavior', () => {
  assert.match(recent, /Fail-safe preserves the previous A \+ shuffled B-E \+ one random F behavior/);
  for (const id of [
    '6Vy6hCA2CZwZalGqaX6Sew', '5EjWZuODqEPQ9eq7XCmITh',
    '6VIY7OFy8g5ZyLSgQEi8lV', '0rUT5nQpBjkg4SPY8jPjcO',
    '2UHNvd8SjNGoEI6jXa2afx',
  ]) assert.match(timed, new RegExp(id));
  assert.match(recent, /kSpotifyFallbackCatalogTracks/);
  assert.match(recent, /kSpotifyFallbackCatalogTracks\.size\(\)/);
});

test('TALKABOUT URL, interval, and playback rate are cloud-managed with a two-hour ceiling', () => {
  assert.match(cloud, /GetNamedObject\(L"talkAbout"\)/);
  assert.match(cloud, /ManagedSpotifyPathFromUrl\(url, L"\/show\/"\)/);
  assert.match(cloud, /GetNamedNumber\(L"intervalMinutes", 120\.0\)/);
  assert.match(cloud, /kSpotifyMaxPodcastIntervalMinutes = 120/);
  assert.match(cloud, /GetNamedNumber\([\s\S]*L"playbackRate"/);
  assert.match(recent, /SpotifyPodcastPlaybackRate\(\)/);
  assert.match(scripts, /target && target\.playbackRate/);
  assert.match(scripts, /Math\.max\(0\.5, Math\.min\(4\.0, requestedRate\)\)/);
  assert.match(timed, /SpotifyPodcastPath\(\)/);
  assert.match(timed, /SpotifyPodcastUrl\(\)/);
  assert.match(rotation, /SpotifyPodcastIntervalMs\(\)/);
  assert.match(rotation, /slot\.timedTarget = TimedSpotifyTarget::TalkAbout/);
  assert.match(schedule, /StartOverduePodcastBreak\(now\)[\s\S]*AdvanceExpiredTimedRotation\(now\)/);
});

test('recent fallback catalog still excludes fixed songs and unwanted variants', () => {
  assert.match(recent, /std::array<SpotifyFallbackCatalogTrack, 34>/);
  const catalogSection = recent.slice(
    recent.indexOf('kSpotifyFallbackCatalogTracks = {{'),
    recent.indexOf('}};', recent.indexOf('kSpotifyFallbackCatalogTracks = {{')),
  );
  for (const fixedId of [
    '6Vy6hCA2CZwZalGqaX6Sew', '5EjWZuODqEPQ9eq7XCmITh',
    '6VIY7OFy8g5ZyLSgQEi8lV', '0rUT5nQpBjkg4SPY8jPjcO',
    '2UHNvd8SjNGoEI6jXa2afx',
  ]) assert.doesNotMatch(catalogSection, new RegExp(fixedId));
  assert.doesNotMatch(catalogSection, /愛MUST BE|OFF VOCAL|Interlude|Remix/);
});

test('direct tracks are passed to the scoped reconcile script without runtime script rewriting', () => {
  assert.match(recent, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.match(recent, /kSpotifyStaticTrackReconcileScript/);
  assert.match(scoped, /targetLink/);
  assert.match(scoped, /scrollIntoView/);
  assert.doesNotMatch(wrapper, /RewriteSpotify|#define ExecuteScript/);
  assert.doesNotMatch(recent, /BuildRecentTrackScript|EscapeRecentScriptLiteral/);
});