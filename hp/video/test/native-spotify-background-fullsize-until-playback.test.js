import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const layout = source('spotify_host_layout.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const click = source('spotify_background_click.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify fits exactly behind the YouTube/TVer panel before confirmed playback', () => {
  assert.match(
    layout,
    /const bool compactPlayback =\s*slot\.playbackConfirmed && CurrentMusicTrack\(slot\) != nullptr/,
  );
  assert.match(layout, /bool SpotifyMediaPanelRect\(HWND parentWindow, RECT\* rect\)/);
  assert.match(layout, /FindWindowExW\([\s\S]*L"HomePanelNativeStaticPanel"[\s\S]*L"HomePanelNativeMedia"/);
  assert.match(layout, /ScreenToClient\(parentWindow, &topLeft\)/);
  assert.match(layout, /ScreenToClient\(parentWindow, &bottomRight\)/);
  assert.match(layout, /int x = mediaPanelRect\.left/);
  assert.match(layout, /int y = mediaPanelRect\.top/);
  assert.match(layout, /int width = compactPlayback \? 1 : mediaPanelWidth/);
  assert.match(layout, /int height = compactPlayback \? 1 : mediaPanelHeight/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('real media start is the point that collapses Spotify to 1x1', () => {
  const confirmed = rotation.indexOf('target->playbackConfirmed = true;');
  const recompute = rotation.indexOf('RecomputeForeground();', confirmed);
  assert.ok(confirmed >= 0 && recompute > confirmed);
  const startBranch = rotation.slice(confirmed, recompute + 'RecomputeForeground();'.length);
  assert.match(startBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(startBranch, /SetMusicCompletionDeadline/);
});

test('ad interruption keeps confirmed playback compact until the target song ends', () => {
  const interrupted = rotation.indexOf('if (interrupted) {');
  const ended = rotation.indexOf('if (ended) {', interrupted);
  assert.ok(interrupted >= 0 && ended > interrupted);
  const branch = rotation.slice(interrupted, ended);
  assert.match(branch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(branch, /RecomputeForeground\(\)/);
  assert.doesNotMatch(branch, /playbackConfirmed = false/);
});

test('track advance clears confirmation so the next target returns behind the media panel', () => {
  const applyStart = rotation.indexOf('void SpotifyWebViews::ApplyTimedRotationTarget');
  const applyEnd = rotation.indexOf('\nvoid SpotifyWebViews::InitializeTimedRotationSlot', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = rotation.slice(applyStart, applyEnd);
  assert.match(apply, /slot\.playbackConfirmed = false/);
  assert.match(apply, /SetSlotState\(slot, SlotState::WaitingTarget\)/);

  const probeStart = schedule.indexOf('ProbeDueTimedCompletions(now);');
  const layoutRefresh = schedule.indexOf('RefreshSpotifyHostLayout();', probeStart);
  assert.ok(probeStart >= 0 && layoutRefresh > probeStart);
});

test('trusted Play no longer depends on the scheduler active slot or a small recovery viewport', () => {
  const clickStart = click.indexOf('void SpotifyWebViews::ClickSlotNormalizedPoint');
  const clickEnd = click.indexOf('\nUINT SpotifyWebViews::DispatchSpotifyDevToolsClick', clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  const handler = click.slice(clickStart, clickEnd);
  assert.match(handler, /SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(handler, /GetClientRect\(slot\.hostWindow, &hostClient\)/);
  assert.match(handler, /PlaceHosts\(\)/);
  assert.doesNotMatch(handler, /hostLayoutActiveSlot_ == slot\.index/);
});
