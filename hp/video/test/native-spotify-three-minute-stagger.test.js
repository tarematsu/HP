import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const header = readFileSync(new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const hostLifecycle = readFileSync(new URL('../../native/src/spotify_host_lifecycle.inc', import.meta.url), 'utf8');
const schedule = readFileSync(new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const timed = readFileSync(new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const cycle = readFileSync(new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');
const music = readFileSync(new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../../native/src/spotify_target_routing.inc', import.meta.url), 'utf8');
const fallback = readFileSync(new URL('../../native/src/spotify_fallback_catalog.inc', import.meta.url), 'utf8');
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
  assert.match(hostLifecycle, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /void SpotifyWebViews::StartAutonomousSchedule/);
  assert.match(schedule, /EnsureCloudPlaylistLoaded\(\)[\s\S]*robustSchedulerStarted_ = true/);
  assert.match(schedule, /if \(!slot\.timedRotationActive\)[\s\S]*InitializeTimedRotationSlot\(slot, now\)/);
  assert.doesNotMatch(header + schedule, /podcastMode_|SetPodcastMode|youtubeCycleStartTick_/);
});

test('cloud rotation supports fixed, shuffle, random, TALKABOUT candidates, and cycle dedupe', () => {
  assert.match(header, /struct RotationGroup/);
  assert.match(header, /Mode : unsigned char \{ Fixed, Shuffle, Random \}/);
  assert.match(header, /std::vector<ManagedTrack> tracks/);
  assert.match(header, /bool includeTalkAbout = false/);
  assert.match(header, /std::vector<ManagedTrack> timedCycleTracks/);
  assert.match(cloud, /GetNamedArray\(L"rotation"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"fixed"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"shuffle"\)/);
  assert.match(cloud, /_wcsicmp\(mode\.c_str\(\), L"random"\)/);
  assert.match(cloud, /GetNamedBoolean\(L"includeTalkAbout", false\)/);
  assert.match(cloud, /GetNamedNumber\(L"count", 1\.0\)/);
  assert.match(cycle, /std::vector<std::wstring> usedPaths/);
  assert.match(cycle, /for \(const RotationGroup& group : cloudRotationGroups_\) appendGroup\(group\)/);
  assert.match(cycle, /std::swap\(candidates\[remaining - 1\], candidates\[swapIndex\]\)/);
  assert.match(cycle, /std::min\(group\.count, candidates\.size\(\)\)/);
  assert.doesNotMatch(rotation, /% 6U|position <= 4U/);
});

test('cycle advances only after the requested track reaches its natural end', () => {
  assert.match(rotation, /\+\+slot\.timedRotationPosition/);
  assert.match(rotation, /slot\.timedRotationPosition >= slot\.timedCycleTracks\.size\(\)/);
  assert.match(rotation, /PrepareTimedRotationCycle\(slot\)/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /spotify:timed-ended/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.doesNotMatch(events, /finishLeadSeconds|duration - finishLeadSeconds/);
  assert.doesNotMatch(header + rotation + schedule, /kSpotifyMusicTrackDeadlineMs|AdvanceExpiredTimedRotation/);
  assert.match(runtime, /spotify:timed-started/);
  assert.match(runtime, /navigator\.mediaSession/);
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /!matchesTarget\(target, identity\)/);
});

test('every cloud song shares one native music descriptor and scoped reconcile path', () => {
  assert.match(header, /struct MusicTargetDescriptor/);
  assert.match(music, /MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget/);
  assert.match(music, /slot\.timedTarget != TimedSpotifyTarget::Music/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(music, /void SpotifyWebViews::NavigateMusicTarget/);
  assert.match(music, /void SpotifyWebViews::ReconcileMusicTarget/);
  assert.match(music, /kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(header + timed + music, /SlotMatchesTimedTarget|NavigateTimedSlot|ReconcileTimedSlot/);
});

test('stale playback events are rejected by target generation', () => {
  assert.match(header, /ULONGLONG targetGeneration = 0/);
  assert.match(rotation, /ParseSpotifyGenerationEvent/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(routing, /spotify:generation/);
  assert.match(routing, /std::to_wstring\(slot\.targetGeneration\)/);
  assert.match(runtime, /message \+ '\\u001f' \+ generation\(\)/);
});

test('invalid or absent cloud rotation retains the former six-song fallback', () => {
  assert.match(cycle, /Fail-safe preserves the former six-song behavior/);
  for (const id of [
    '6Vy6hCA2CZwZalGqaX6Sew', '5EjWZuODqEPQ9eq7XCmITh',
    '6VIY7OFy8g5ZyLSgQEi8lV', '0rUT5nQpBjkg4SPY8jPjcO',
    '2UHNvd8SjNGoEI6jXa2afx',
  ]) assert.match(timed, new RegExp(id));
  assert.match(cycle, /kSpotifyFallbackCatalogTracks/);
  assert.match(cycle, /kSpotifyFallbackCatalogTracks\.size\(\)/);
});

test('TALKABOUT direct episode and playback rate are cloud-managed without a timed interval', () => {
  assert.match(cloud, /GetNamedObject\(L"talkAbout"\)/);
  assert.match(cloud, /GetNamedString\(L"episodeUrl", L""\)/);
  assert.match(cloud, /ManagedSpotifyPathFromUrl\(episodeUrl, L"\/episode\/"\)/);
  assert.match(cloud, /SpotifyPodcastTargetReady\(\) const noexcept/);
  assert.match(cloud, /GetNamedNumber\([\s\S]*L"playbackRate"/);
  assert.doesNotMatch(cloud + header + schedule + rotation, /intervalMinutes|SpotifyPodcastIntervalMs|StartOverduePodcastBreak/);
  assert.match(routing, /SpotifyPodcastPlaybackRate\(\)/);
  assert.match(scripts, /target && target\.playbackRate/);
  assert.match(scripts, /Math\.max\(0\.5, Math\.min\(4\.0, requestedRate\)\)/);
  assert.match(timed, /SpotifyPodcastPath\(\)/);
  assert.match(timed, /SpotifyPodcastUrl\(\)/);
  assert.doesNotMatch(timed, /source\.find\(L"\/episode\/"\)/);
  assert.match(rotation, /target\.path == SpotifyPodcastPath\(\)/);
  assert.match(rotation, /TimedSpotifyTarget::TalkAbout/);
});

test('fallback catalog excludes fixed songs and unsupported variants', () => {
  assert.match(fallback, /std::array<SpotifyFallbackCatalogTrack, \d+>/);
  const catalogSection = fallback.slice(
    fallback.indexOf('kSpotifyFallbackCatalogTracks = {{'),
    fallback.indexOf('}};', fallback.indexOf('kSpotifyFallbackCatalogTracks = {{')),
  );
  for (const fixedId of [
    '6Vy6hCA2CZwZalGqaX6Sew', '5EjWZuODqEPQ9eq7XCmITh',
    '6VIY7OFy8g5ZyLSgQEi8lV', '0rUT5nQpBjkg4SPY8jPjcO',
    '2UHNvd8SjNGoEI6jXa2afx',
  ]) assert.doesNotMatch(catalogSection, new RegExp(fixedId));
  assert.doesNotMatch(catalogSection, /愛MUST BE|Remix/);
  for (const shortTrack of [
    'Sunny side up', 'キスが苦い', 'やるしかないじゃん', '恋愛無双',
    '死んだふり', 'Make or Break', '行かないで', 'ドライフルーツ',
    'Nightmare症候群',
    'Interlude #1', 'Interlude #2', 'Interlude #4', 'Interlude #6',
    'Overture',
  ]) assert.match(catalogSection, new RegExp(shortTrack));
});

test('direct tracks are passed to the scoped reconcile script without runtime script rewriting', () => {
  assert.match(music, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.match(music, /kSpotifyStaticTrackReconcileScript/);
  assert.match(scoped, /targetLink/);
  assert.match(scoped, /scrollIntoView/);
  assert.doesNotMatch(wrapper, /RewriteSpotify|#define ExecuteScript/);
  assert.doesNotMatch(music, /BuildRecentTrackScript|EscapeRecentScriptLiteral/);
});
