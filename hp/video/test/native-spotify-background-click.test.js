import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const helper = source('spotify_background_click.inc');
const startup = source('spotify_startup_audio_recovery.inc');
const trackRecovery = source('spotify_track_start_recovery.h');
const music = source('spotify_music_target.inc');
const layout = source('spotify_host_layout.inc');
const header = source('spotify_webviews.h');
const hostLifecycle = source('spotify_host_lifecycle.inc');

test('Spotify Play clicks use only WebView2 CDP trusted input', () => {
  assert.match(wrapper, /#include "spotify_background_click\.inc"/);
  assert.doesNotMatch(wrapper, /#define SendInput|#define ExecuteScript/);
  assert.match(helper, /CallDevToolsProtocolMethod\(/);
  assert.match(helper, /L"Input\.dispatchMouseEvent"/);
  assert.match(helper, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(helper, /SetForegroundWindow|SendInput|MOUSEEVENTF_/);
});

test('Spotify trusted click uses a two-second state probe with a duplicate-click guard', () => {
  assert.match(header, /ULONGLONG trustedClickBlockedUntilTick = 0/);
  assert.match(header, /SpotifyTrackStartRecovery trackStartRecovery\{\}/);
  assert.match(header, /ULONGLONG pageEpoch = 0/);
  assert.match(header, /bool nativeAudioStartVerified = false/);
  assert.match(music, /kSpotifyPlaybackStateProbeMs = 2ULL \* 1000ULL/);
  assert.match(music, /kSpotifyCdpPlayRetryFailsafeMs = 5ULL \* 1000ULL/);
  assert.match(helper, /now < slot\.trustedClickBlockedUntilTick/);
  assert.match(helper, /trustedClickBlockedUntilTick = now \+ kSpotifyCdpPlayRetryFailsafeMs/);
  assert.match(helper, /nextRecoveryTick = now \+ kSpotifyPlaybackStateProbeMs/);
  assert.match(helper, /target->targetGeneration != targetGeneration/);
  assert.match(helper, /target->pageEpoch != pageEpoch/);
  assert.match(helper, /target->webview\.Get\(\) != view\.Get\(\)/);
});

test('normal startup recovery is not embedded in the click path', () => {
  assert.doesNotMatch(helper, /__homePanelSpotifyNativePlayRetry/);
  assert.doesNotMatch(helper, /retry\.count|return 'reload'|return 'recreate'/);
  assert.doesNotMatch(helper, /EscalateSpotifyStartupFailure/);
  assert.match(trackRecovery, /ConsumeSpotifyStartupReload/);
  assert.match(startup, /ConsumeSpotifyStartupReload/);
  assert.match(startup, /slot\.webview->Reload\(\)/);
  assert.match(startup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(startup, /RebuildSurface|mediaPipelineRecoveryPending = true/);
});

test('target changes and WebView rebuilds invalidate old trusted click chains', () => {
  assert.match(helper, /target->targetGeneration != targetGeneration/);
  assert.match(helper, /target->pageEpoch != pageEpoch/);
  assert.match(helper, /target->webview\.Get\(\) != view\.Get\(\)/);
  assert.match(hostLifecycle, /\+\+slot\.pageEpoch/);
  assert.match(hostLifecycle, /slot\.trustedClickBlockedUntilTick = 0/);
});

test('Spotify playback hosts stay on fixed Monitor S tiles and all five foreground together', () => {
  assert.match(layout, /const RECT serviceTile = ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.match(layout, /const RECT desired = loginPage \? fullClient : serviceTile/);
  assert.match(layout, /const bool gridForeground = gSpotifyMonitorGridVisible && !loginPage/);
  assert.match(layout, /gridForeground \|\| monitorForeground \|\| authenticationForeground/);
  assert.match(layout, /authentication \|\| monitorForeground \|\| gridForeground/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('trusted click uses CSS viewport points and repairs accidental 1x1 placement', () => {
  assert.match(helper, /bool SpotifyWebViews::ParseCssPoint/);
  assert.match(helper, /void SpotifyWebViews::ClickSlotCssPoint/);
  assert.match(
    helper,
    /if \(slot\.playbackConfirmed && slot\.nativeAudioStartVerified &&[\s\S]*slot\.state == SlotState::Playing\) \{[\s\S]*return;/,
  );
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
  assert.match(preflight, /testid!==\'play-button\'&&testid!==\'control-button-playpause\'/);
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
