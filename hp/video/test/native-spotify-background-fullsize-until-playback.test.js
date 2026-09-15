import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const layout = source('spotify_host_layout.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const click = source('spotify_background_click.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify uses one onscreen 160x320 air-panel surface for startup, playback, recovery and Monitor C', () => {
  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);
  assert.match(layout, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(layout, /anchors\.air/);
  assert.match(layout, /CenterMediaSurfaceOnAnchor/);
  assert.match(layout, /const int hostX = backgroundSurface\.left/);
  assert.match(layout, /const int hostY = backgroundSurface\.top/);
  assert.doesNotMatch(layout, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\)/);
  assert.doesNotMatch(layout, /client\.right \+ 1|client\.bottom \+ 1/);
  assert.match(layout, /const int width = std::max\(1L, backgroundSurface\.right - backgroundSurface\.left\)/);
  assert.match(layout, /const int height = std::max\(1L, backgroundSurface\.bottom - backgroundSurface\.top\)/);
  assert.match(layout, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(layout, /width = clientWidth|height = clientHeight/);
  assert.match(layout, /const RECT desired\{hostX, hostY, hostX \+ width, hostY \+ height\}/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter,[\s\S]*hostX, hostY, width, height, flags\)/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('real media start records playback confirmation while keeping the host onscreen in the background', () => {
  const confirmed = rotation.indexOf('target->playbackConfirmed = true;');
  const recompute = rotation.indexOf('RecomputeForeground();', confirmed);
  assert.ok(confirmed >= 0 && recompute > confirmed);
  const startBranch = rotation.slice(confirmed, recompute + 'RecomputeForeground();'.length);
  assert.match(startBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(startBranch, /SetMusicCompletionDeadline/);
  assert.doesNotMatch(layout, /client\.right \+ 1|client\.bottom \+ 1/);
});

test('ad interruption keeps Spotify on the same onscreen air-panel background surface', () => {
  const interrupted = rotation.indexOf('if (interrupted) {');
  const ended = rotation.indexOf('if (ended) {', interrupted);
  assert.ok(interrupted >= 0 && ended > interrupted);
  const branch = rotation.slice(interrupted, ended);
  assert.match(branch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(branch, /RecomputeForeground\(\)/);
  assert.match(layout, /const int hostX = backgroundSurface\.left/);
  assert.match(layout, /const int hostY = backgroundSurface\.top/);
});

test('normal track advance retains the fixed 160x320 air-panel geometry until the next start', () => {
  const applyStart = rotation.indexOf('void SpotifyWebViews::ApplyTimedRotationTarget');
  const applyEnd = rotation.indexOf('\nvoid SpotifyWebViews::InitializeTimedRotationSlot', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = rotation.slice(applyStart, applyEnd);
  assert.match(apply, /slot\.playbackConfirmed = false/);
  assert.match(apply, /BumpSpotifyTargetGeneration\(slot\)/);
  assert.match(apply, /SetSlotState\(slot, SlotState::WaitingTarget\)/);
  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);

  const probeStart = schedule.indexOf('ProbeDueTimedCompletions(now);');
  const layoutRefresh = schedule.indexOf('RefreshSpotifyHostLayout();', probeStart);
  assert.ok(probeStart >= 0 && layoutRefresh > probeStart);
});

test('trusted Play no longer depends on the scheduler active slot or a small recovery viewport', () => {
  const clickStart = click.indexOf('void SpotifyWebViews::ClickSlotCssPoint');
  const clickEnd = click.indexOf('\nUINT SpotifyWebViews::DispatchSpotifyDevToolsClick', clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  const handler = click.slice(clickStart, clickEnd);
  assert.match(handler, /SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(handler, /GetClientRect\(slot\.hostWindow, &hostClient\)/);
  assert.match(handler, /PlaceHosts\(\)/);
  assert.match(handler, /return \[centerX,centerY\]/);
  assert.doesNotMatch(handler, /hostLayoutActiveSlot_ == slot\.index/);
});
