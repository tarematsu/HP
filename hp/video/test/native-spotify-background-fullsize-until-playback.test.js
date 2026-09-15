import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const layout = source('spotify_host_layout.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const click = source('spotify_background_click.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify uses 480x270 for startup and every non-playing transition, offscreen while Playing, and full-size Monitor C', () => {
  assert.match(layout, /kSpotifyBackgroundWidth = 480/);
  assert.match(layout, /kSpotifyBackgroundHeight = 270/);
  assert.match(layout, /const int x = client\.left/);
  assert.match(layout, /const int y = client\.top/);
  assert.match(layout, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\)/);
  assert.match(layout, /int hostX = backgroundWork \|\| authentication \? x : client\.right \+ 1/);
  assert.match(layout, /int hostY = backgroundWork \|\| authentication \? y : client\.bottom \+ 1/);
  assert.match(layout, /int width = std::min\(kSpotifyBackgroundWidth, clientWidth\)/);
  assert.match(layout, /int height = std::min\(kSpotifyBackgroundHeight, clientHeight\)/);
  assert.match(layout, /HWND insertAfter = authentication \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /if \(monitorForeground_\) \{[\s\S]*hostX = x;[\s\S]*hostY = y;[\s\S]*width = clientWidth;[\s\S]*height = clientHeight;[\s\S]*insertAfter = HWND_TOP;/);
  assert.match(layout, /const RECT desired\{hostX, hostY, hostX \+ width, hostY \+ height\}/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter,[\s\S]*hostX, hostY, width, height, flags\)/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('real media start records playback confirmation and parks stable playback offscreen', () => {
  const confirmed = rotation.indexOf('target->playbackConfirmed = true;');
  const recompute = rotation.indexOf('RecomputeForeground();', confirmed);
  assert.ok(confirmed >= 0 && recompute > confirmed);
  const startBranch = rotation.slice(confirmed, recompute + 'RecomputeForeground();'.length);
  assert.match(startBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(startBranch, /SetMusicCompletionDeadline/);
});

test('ad interruption returns Spotify from offscreen playback to the background surface', () => {
  const interrupted = rotation.indexOf('if (interrupted) {');
  const ended = rotation.indexOf('if (ended) {', interrupted);
  assert.ok(interrupted >= 0 && ended > interrupted);
  const branch = rotation.slice(interrupted, ended);
  assert.match(branch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(branch, /RecomputeForeground\(\)/);
  assert.match(layout, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\)/);
});

test('normal track advance leaves Playing and therefore returns the host to 480x270 background until the next start', () => {
  const applyStart = rotation.indexOf('void SpotifyWebViews::ApplyTimedRotationTarget');
  const applyEnd = rotation.indexOf('\nvoid SpotifyWebViews::InitializeTimedRotationSlot', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = rotation.slice(applyStart, applyEnd);
  assert.match(apply, /slot\.playbackConfirmed = false/);
  assert.match(apply, /BumpSpotifyTargetGeneration\(slot\)/);
  assert.match(apply, /SetSlotState\(slot, SlotState::WaitingTarget\)/);
  assert.match(layout, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\)/);

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
