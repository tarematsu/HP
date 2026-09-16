import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const layout = source('spotify_host_layout.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const click = source('spotify_background_click.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify uses one full-client internal surface for startup, playback, recovery and Monitor C/D', () => {
  assert.match(layout, /const int hostX = client\.left/);
  assert.match(layout, /const int hostY = client\.top/);
  assert.match(layout, /const int width = std::max\(1L, client\.right - client\.left\)/);
  assert.match(layout, /const int height = std::max\(1L, client\.bottom - client\.top\)/);
  assert.doesNotMatch(layout, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\)/);
  assert.match(layout, /const bool monitorForeground =\s*static_cast<int>\(i\) == monitorForegroundSlot_/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /authentication \|\| monitorForeground/);
  assert.match(layout, /const RECT desired\{hostX, hostY, hostX \+ width, hostY \+ height\}/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter,[\s\S]*hostX, hostY, width, height, flags\)/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor|compactPlayback|SpotifyMediaPanelRect/);
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

test('ad interruption keeps Spotify on the same full-client background surface', () => {
  const interrupted = rotation.indexOf('if (interrupted) {');
  const ended = rotation.indexOf('if (ended) {', interrupted);
  assert.ok(interrupted >= 0 && ended > interrupted);
  const branch = rotation.slice(interrupted, ended);
  assert.match(branch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(branch, /RecomputeForeground\(\)/);
  assert.match(layout, /const int hostX = client\.left/);
  assert.match(layout, /const int hostY = client\.top/);
});

test('normal track advance retains the full-client geometry until the next start', () => {
  const applyStart = rotation.indexOf('void SpotifyWebViews::ApplyTimedRotationTarget');
  const applyEnd = rotation.indexOf('\nvoid SpotifyWebViews::InitializeTimedRotationSlot', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = rotation.slice(applyStart, applyEnd);
  assert.match(apply, /slot\.playbackConfirmed = false/);
  assert.match(apply, /BumpSpotifyTargetGeneration\(slot\)/);
  assert.match(apply, /SetSlotState\(slot, SlotState::WaitingTarget\)/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);

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
