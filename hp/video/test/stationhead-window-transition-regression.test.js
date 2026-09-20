import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const layout = source('sh_layout.cpp');
const handles = source('app_stationhead_handles.cpp');
const audio = source('sh_audio.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

const applyLayout = section(layout, 'void ApplyStationheadChildLayout(',
  '}  // namespace');

test('auth promotion keeps playback host alive onscreen behind the auth surface', () => {
  assert.match(applyLayout, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /playbackHostBounds = surfaceBounds/);
  assert.match(applyLayout, /authHostBounds = surfaceBounds/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(applyLayout, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.match(applyLayout, /controller->put_IsVisible\(TRUE\)/);
  assert.match(applyLayout, /authController->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(applyLayout, /StationheadOffscreenBounds|offscreen|SW_HIDE/);
});

test('background host stays full-client while playback controller stays fixed at 360x960', () => {
  assert.match(applyLayout, /SetWindowPos\(hostWindow, hostPlacement/);
  assert.match(applyLayout, /SetWindowPos\(authHostWindow, authPlacement/);
  assert.match(applyLayout, /const RECT playbackControllerBounds = StationheadPlaybackControllerBounds\(\);/);
  assert.match(applyLayout, /const RECT authControllerBounds\{0, 0, authWidth, authHeight\};/);
  assert.match(layout, /kStationheadPlaybackViewportWidth = 360/);
  assert.match(layout, /kStationheadPlaybackViewportHeight = 960/);
  assert.doesNotMatch(applyLayout, /compactPlayback|useCompactPlayback/);
  assert.doesNotMatch(applyLayout, /hostWidth = .*: 1|StationheadOffscreenBounds/);
});

test('only interactive surfaces receive WebView2 focus', () => {
  const visible = section(layout, 'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()');
  assert.match(visible, /StationheadTabKind::Auth/);
  assert.match(visible, /MoveFocus\(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC\)/);
  assert.match(visible, /WindowContainsFocus/);
});

test('account setup returns the active host', () => {
  const host = section(layout,
    'HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept',
    '}  // namespace hp');
  assert.match(host, /StationheadTabKind::Auth[\s\S]*return authHostWindow_/);
  assert.match(host, /StationheadTabKind::Stationhead[\s\S]*return hostWindow_/);
});

test('interactive-window predicate remains unchanged after layout refactor', () => {
  const predicate = section(audio,
    'bool StationheadPlayer::NeedsInteractiveWindow() const',
    '}  // namespace hp');
  assert.match(predicate,
    /StationheadTabKind::Stationhead && loginRequired_/);
  assert.match(predicate, /StationheadTabKind::Auth/);
  assert.match(predicate, /spotifyAuthorization_/);
});

test('unchanged bounds still repair z-order and size', () => {
  const playerBounds = section(layout, 'void StationheadPlayer::SetBounds(const RECT& bounds)',
    'void StationheadPlayer::SetForegroundAllowed(');
  assert.match(playerBounds, /LayoutControllers\(\)/);
  assert.doesNotMatch(playerBounds, /EqualRect\(&bounds_, &resolved\)\) return/);

  const handleBounds = section(handles, 'void StationheadHandleBase::SetBounds(const RECT& bounds)',
    'StationheadStatus StationheadHandleBase::RawStatus() const');
  assert.match(handleBounds, /workspaceBounds_ = bounds/);
  assert.match(handleBounds, /ApplyBounds\(\)/);
});
