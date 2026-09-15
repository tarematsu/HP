import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const helper = source('spotify_background_click.inc');
const music = source('spotify_music_target.inc');
const layout = source('spotify_host_layout.inc');
const header = source('spotify_webviews.h');
const hostLifecycle = source('spotify_host_lifecycle.inc');

test('Spotify recovery clicks use only WebView2 CDP trusted input', () => {
  assert.match(wrapper, /#include "spotify_background_click\.inc"/);
  assert.doesNotMatch(wrapper, /#define SendInput|#define ExecuteScript/);
  assert.match(helper, /CallDevToolsProtocolMethod\(/);
  assert.match(helper, /L"Input\.dispatchMouseEvent"/);
  assert.match(helper, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(helper, /SetForegroundWindow|SendInput|MOUSEEVENTF_/);
});

test('Spotify trusted click uses the same five-second native confirmation gate', () => {
  assert.match(header, /ULONGLONG trustedClickBlockedUntilTick = 0/);
  assert.match(header, /ULONGLONG pageEpoch = 0/);
  assert.doesNotMatch(header, /trustedClickGeneration|trustedClickTargetGeneration|trustedClickInFlight|trustedClickStartTick/);
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.match(helper, /now < slot\.trustedClickBlockedUntilTick/);
  assert.match(helper, /slot\.trustedClickBlockedUntilTick = now \+ kSpotifyCdpPlayConfirmWaitMs/);
  assert.match(helper, /target->targetGeneration != targetGeneration/);
  assert.match(helper, /target->pageEpoch != pageEpoch/);
  assert.match(helper, /target->webview\.Get\(\) != view\.Get\(\)/);
});

test('target changes and WebView rebuilds invalidate old trusted click chains', () => {
  assert.match(helper, /target->targetGeneration != targetGeneration/);
  assert.match(helper, /target->pageEpoch != pageEpoch/);
  assert.match(helper, /target->webview\.Get\(\) != view\.Get\(\)/);
  assert.match(hostLifecycle, /\+\+slot\.pageEpoch/);
  assert.match(hostLifecycle, /slot\.trustedClickBlockedUntilTick = 0/);
});

test('Spotify keeps a 160x320 onscreen surface behind the air panel for recovery, playback and authentication', () => {
  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);
  assert.match(layout, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(layout, /anchors\.air/);
  assert.match(layout, /CenterMediaSurfaceOnAnchor/);
  assert.match(layout, /const int hostX = backgroundSurface\.left;/);
  assert.match(layout, /const int hostY = backgroundSurface\.top;/);
  assert.match(layout, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(layout, /client\.right \+ 1|client\.bottom \+ 1/);
  assert.doesNotMatch(layout, /width = clientWidth|height = clientHeight/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('trusted click uses CSS viewport points and repairs accidental 1x1 placement', () => {
  assert.match(helper, /bool SpotifyWebViews::ParseCssPoint/);
  assert.match(helper, /void SpotifyWebViews::ClickSlotCssPoint/);
  assert.match(helper, /if \(slot\.playbackConfirmed\) \{[\s\S]*return;/);
  assert.match(helper, /const bool recoveryViewportReady = SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(helper, /GetClientRect\(slot\.hostWindow, &hostClient\)/);
  assert.match(helper, /slot\.hostLayoutApplied = false;/);
  assert.match(helper, /PlaceHosts\(\);/);
});

test('trusted click preflight is observer-independent and rejects Pause', () => {
  const preflight = helper.slice(
    helper.indexOf('void SpotifyWebViews::ClickSlotCssPoint'),
    helper.indexOf('UINT SpotifyWebViews::DispatchSpotifyDevToolsClick'),
  );
  assert.doesNotMatch(preflight, /timedObserverReady|ArmTimedEndObserver|__homePanelSpotifyMediaObserverRuntime|armTrustedStart/);
  assert.doesNotMatch(preflight, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(preflight, /document\.elementFromPoint\(x,y\)/);
  assert.match(preflight, /testid==='play-button'\|\|testid==='control-button-playpause'/);
  assert.match(preflight, /label\.includes\('pause'\)\|\|label\.includes\('一時停止'\)/);
  assert.match(preflight, /const centerX=rect\.left\+rect\.width\/2/);
  assert.match(preflight, /const centerY=rect\.top\+rect\.height\/2/);
  assert.match(preflight, /return \[centerX,centerY\]/);
  assert.match(preflight, /ParseCssPoint\(json, &verifiedX, &verifiedY\)/);
  assert.match(preflight, /DispatchSpotifyDevToolsClick\(\*target, verifiedX, verifiedY\)/);
});

test('CDP dispatch uses the verified CSS coordinates verbatim with no DPI or zoom reconstruction', () => {
  const dispatch = helper.slice(
    helper.indexOf('UINT SpotifyWebViews::DispatchSpotifyDevToolsClick'),
  );
  assert.match(dispatch, /const double x = cssX;/);
  assert.match(dispatch, /const double y = cssY;/);
  assert.doesNotMatch(dispatch, /get_ZoomFactor|get_RasterizationScale|GetDpiForWindow|cssWidth|cssHeight|xTenThousandths|yTenThousandths/);
  assert.match(dispatch, /Input\.dispatchMouseEvent/);
});
