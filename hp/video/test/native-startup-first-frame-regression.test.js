import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const spotifyLayout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const stationheadLayout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

test('native app primes the dashboard before exposing the top-level HWND', () => {
  const createWindow = app.slice(
    app.indexOf('void App::CreateMainWindow'),
    app.indexOf('void App::StartServices'),
  );
  assert.match(createWindow, /windowClass\.hbrBackground = nullptr/);
  assert.doesNotMatch(createWindow, /GetStockObject\(BLACK_BRUSH\)/);

  const startServices = app.slice(
    app.indexOf('void App::StartServices'),
    app.indexOf('void App::StartDeferredServices'),
  );
  const renderAt = startServices.indexOf('renderer_->Render();');
  const redrawAt = startServices.indexOf('RedrawWindow(window_');
  const showAt = startServices.indexOf('ShowWindow(window_, startupShowCommand_);');
  assert.ok(renderAt >= 0);
  assert.ok(redrawAt > renderAt);
  assert.ok(showAt > redrawAt);
  assert.match(
    startServices,
    /RDW_INVALIDATE \| RDW_UPDATENOW \| RDW_ALLCHILDREN/,
  );
});

test('deferred Spotify hosts are clipped before SWP_SHOWWINDOW can expose them', () => {
  const placeHosts = spotifyLayout.slice(
    spotifyLayout.indexOf('void SpotifyWebViews::PlaceHosts()'),
    spotifyLayout.indexOf('void SpotifyWebViews::RefreshSpotifyHostLayout()'),
  );
  const clipAt = placeHosts.indexOf('ApplySpotifyHostVisualClip(');
  const showAt = placeHosts.indexOf('UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;');
  assert.ok(clipAt >= 0);
  assert.ok(showAt > clipAt);
  assert.match(
    placeHosts,
    /ApplySpotifyHostVisualClip\([\s\S]*authentication \|\| monitorForeground\)/,
  );
});

test('deferred Stationhead hosts are clipped before SWP_SHOWWINDOW can expose them', () => {
  const start = stationheadLayout.indexOf('void ApplyStationheadChildLayout(');
  const end = stationheadLayout.indexOf('}  // namespace', start);
  const layout = stationheadLayout.slice(start, end);
  const authClipAt = layout.indexOf('ApplyHostVisualClip(authHostWindow, showAuth);');
  const authShowAt = layout.indexOf('SetWindowPos(authHostWindow, authPlacement');
  const playbackClipAt = layout.indexOf('ApplyHostVisualClip(hostWindow, playbackForeground);');
  const playbackShowAt = layout.indexOf('SetWindowPos(hostWindow, hostPlacement');
  assert.ok(authClipAt >= 0 && authShowAt > authClipAt);
  assert.ok(playbackClipAt >= 0 && playbackShowAt > playbackClipAt);
});
