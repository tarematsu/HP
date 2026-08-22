import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('native dashboard compiles the MV panel and its WebView2 environment dependency', () => {
  assert.match(entry, /#include "mv_section\.inc"/);
  assert.doesNotMatch(entry, /media_section_v2\.inc/);
  assert.match(composition, /#include "shared_webview_environment\.h"/);
  assert.match(mvPanel, /void Renderer::DrawMusicSection/);
  assert.match(mvPanel, /EnsureNativeMvPanel\(nativeMainWindow_, dataDir_, playerBounds\)/);
});

test('MV sources are the Sakurazaka Channel uploads and official Music Videos playlist', () => {
  assert.match(mvPanel, /UUDNDlqJRz4FsO_ByfUNOSuQ/);
  assert.match(mvPanel, /PL0eK3gfF1BbM6tiu8UThzL9nYNowS8LL2/);
  assert.match(mvPanel, /櫻坂チャンネル/);
  assert.match(mvPanel, /櫻坂46 MUSIC VIDEO/);
});

test('each source is random while completed videos switch sources strictly', () => {
  assert.match(mvPanel, /crypto\.getRandomValues/);
  assert.match(mvPanel, /player\.cuePlaylist/);
  assert.match(mvPanel, /player\.getPlaylist\(\)/);
  assert.match(mvPanel, /player\.playVideoAt\(index\)/);
  assert.match(mvPanel, /YT\.PlayerState\.ENDED/);
  assert.match(mvPanel, /loadSource\(1 - currentSource\)/);
});

test('embedded playback uses a local HTTPS virtual host and an autoplay fallback', () => {
  assert.match(mvPanel, /SetVirtualHostNameToFolderMapping/);
  assert.match(mvPanel, /https:\/\/homepanel\.mv\/index\.html/);
  assert.match(mvPanel, /autoplay: 1/);
  assert.match(mvPanel, /onAutoplayBlocked: showResume/);
  assert.match(mvPanel, />再生<\/button>/);
});

test('Stationhead audio is muted once when the MV surface becomes active', () => {
  assert.match(mvPanel, /static bool stationheadMuteQueued = false/);
  assert.match(mvPanel, /QueueAction\(UiAction::StationheadAudioMute\)/);
});
