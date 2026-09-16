import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const header = source('spotify_webviews.h');
const hostLifecycle = source('spotify_host_lifecycle.inc');
const phase = source('spotify_phase_sync.inc');
const schedule = source('spotify_stagger_schedule.inc');
const timed = source('spotify_timed_sequence.inc');
const cycle = source('spotify_rotation_cycle.inc');
const music = source('spotify_music_target.inc');
const routing = source('spotify_target_routing.inc');
const fallback = source('spotify_fallback_catalog.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const scoped = source('spotify_scoped_track_reconcile.inc');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const cloud = source('spotify_cloud_playlist.inc');

test('Spotify startup uses thirty-second stagger and one adaptive scheduler timer', () => {
  assert.match(wrapper, /spotify_stagger_schedule\.inc/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 30ULL \* 1000ULL/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(phase, /SchedulerTimerProc/);
  assert.match(schedule, /const auto startupReady/);
  assert.equal((schedule.match(/for \(size_t step = 0; step < count; \+\+step\)/g) || []).length, 1);
  assert.doesNotMatch(phase + schedule, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});

test('Spotify schedule starts autonomously, warms the controller, and gates rotation on cloud readiness', () => {
  assert.match(hostLifecycle, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /BeginInitialCloudPlaylistWait\(now\)/);
  assert.match(schedule, /const bool cloudPlaylistReady = InitialCloudPlaylistReady\(now\)/);
  assert.match(schedule, /if \(!slot\.webview\) \{[\s\S]*BeginControllerCreate\(slot\)[\s\S]*return/);
  assert.match(schedule, /if \(!cloudPlaylistReady\) return;[\s\S]*InitializeTimedRotationSlot\(slot\)/);
  assert.match(schedule, /NavigateMusicTarget\(slot\)/);
});

test('cloud rotation supports fixed shuffle random and cycle dedupe', () => {
  assert.match(header, /Mode : unsigned char \{ Fixed, Shuffle, Random \}/);
  assert.match(cloud, /GetNamedArray\(L"rotation"\)/);
  assert.match(cloud, /L"fixed"/);
  assert.match(cloud, /L"shuffle"/);
  assert.match(cloud, /L"random"/);
  assert.match(cycle, /std::vector<std::wstring> usedPaths/);
  assert.match(cycle, /std::swap\(candidates\[remaining - 1\], candidates\[swapIndex\]\)/);
});

test('cycle advances only through the native deadline and queues later navigation', () => {
  assert.match(rotation, /\+\+slot\.timedRotationPosition/);
  assert.match(rotation, /PrepareTimedRotationCycle\(slot\)/);
  assert.match(runtime, /spotify:timed-started/);
  assert.match(runtime, /spotify:timed-resumed/);
  assert.match(events, /spotify:timed-ended/);
  assert.match(rotation, /SetMusicCompletionDeadline/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot\)/);
  const advanceStart = rotation.indexOf('void SpotifyWebViews::AdvanceTimedRotationSlot');
  const advanceEnd = rotation.indexOf('\nvoid SpotifyWebViews::ProbeDueTimedCompletions', advanceStart);
  assert.ok(advanceStart >= 0 && advanceEnd > advanceStart);
  assert.doesNotMatch(rotation.slice(advanceStart, advanceEnd), /NavigateMusicTarget|RefreshSpotifyHostLayout/);
  assert.doesNotMatch(runtime + events + rotation, /spotify:timed-plan|SpotifyDeadlineWithInterruptionHold/);
});

test('every cloud song uses ManagedTrack and one directly referenced scoped reconcile script', () => {
  assert.doesNotMatch(header + music, /MusicTargetDescriptor|TimedSpotifyTarget|ResolveMusicTarget/);
  assert.match(header, /const ManagedTrack\* CurrentMusicTrack/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(music, /void SpotifyWebViews::NavigateMusicTarget/);
  assert.match(music, /void SpotifyWebViews::ReconcileMusicTarget/);
  assert.match(music, /kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyStaticTrackReconcileScript/);
});

test('stale playback events are rejected by target generation', () => {
  assert.match(header, /ULONGLONG targetGeneration = 0/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(routing, /spotify:generation/);
  assert.match(routing, /std::to_wstring\(slot\.targetGeneration\)/);
});

test('invalid cloud rotation retains the fallback catalog and runtime remains music-only', () => {
  assert.match(cycle, /Fail-safe preserves the former six-song behavior/);
  assert.match(cycle, /kSpotifyFallbackCatalogTracks/);
  assert.match(fallback, /std::array<SpotifyFallbackCatalogTrack, \d+>/);
  assert.doesNotMatch(
    header + cloud + cycle + timed + routing + rotation + schedule,
    /TalkAbout|TALKABOUT|talkAbout|includeTalkAbout|SpotifyPodcast|podcastBreakActive|TimedSpotifyTarget/,
  );
});

test('direct tracks use the CDP-only scoped reconcile script without runtime rewriting', () => {
  assert.match(music, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.match(music, /kSpotifyScopedTrackReconcileScript/);
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /const pageButtons =/);
  assert.match(scoped, /currentTrackMatchesTarget/);
  assert.match(scoped, /navigator\.mediaSession/);
  assert.match(scoped, /return point\(visiblePageButton\)/);
  assert.doesNotMatch(scoped, /point\(playerPause\)|document\.querySelector\('audio'\)|audio\.play\(|direct-play|DirectPlay/);
  assert.doesNotMatch(scoped, /targetLink|settling/);
  assert.doesNotMatch(wrapper, /RewriteSpotify|#define ExecuteScript|kSpotifyStaticTrackReconcileScript/);
});
