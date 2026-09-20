import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const messages = source('app_messages.cpp');
const layout = source('sh_layout.cpp');
const webview = source('sh_webview.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

function ordered(text, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = text.indexOf(marker);
    assert.ok(at > previous, `missing/out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('pending Spotify auth hides playback until its surface is usable', () => {
  const policy = section(layout,
    'constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(',
    'static_assert(!ResolveStationheadSurfacePolicy(');
  assert.match(policy, /return \{authSelected && authSurfaceReady, playbackSelected, authSelected\};/);
  assert.match(layout, /StationheadTabKind::Auth, false, false\)\.hidePlayback/);
});

test('Stationhead playback surface is foreground only for confirmed in-page authentication', () => {
  const policy = section(layout,
    'constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(',
    'static_assert(!ResolveStationheadSurfacePolicy(');
  assert.match(
    policy,
    /selectedTab == StationheadTabKind::Stationhead && loginRequired/,
  );
  assert.match(
    layout,
    /!ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, false\)\.showPlayback/,
  );
  assert.match(
    layout,
    /ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, true\)\.showPlayback/,
  );
});

test('auth callback publishes readiness before exposing the auth surface', () => {
  const auth = section(webview, 'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()');
  ordered(auth, ['status_.detail = L"Spotify login ready";',
    'SelectTab(StationheadTabKind::Auth);', 'PostChange();']);
});

test('all Stationhead windows re-evaluate placement on state change', () => {
  const changed = section(messages, 'case WM_HP_STATIONHEAD_CHANGED:',
    'case kStationheadHealthUpdatedMessage:');
  assert.match(changed, /stationheadPeers_\[i\]->ConsumeChangeFlags\(\)/);
  assert.match(changed, /stationhead_->ConsumeChangeFlags\(\)/);
  assert.match(changed, /MarkStationheadPlacementDirty\(\)/);
  assert.match(changed, /ApplyStationheadWindowPlacement\(\)/);
  assert.match(changed, /ScheduleNextTick\(1\)/);
});

test('popup authorization becomes active before its controller is created', () => {
  const popup = section(webview,
    'const HRESULT newWindowResult = webview_->add_NewWindowRequested(',
    'if (FAILED(newWindowResult))');
  ordered(popup, ['spotifyAuthorization_ = true;',
    'SelectTab(StationheadTabKind::Auth);',
    'CreateProfileController(authHostWindow_, onController.Get())']);
});
