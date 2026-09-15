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

test('Spotify trusted click uses the same five-second confirmation gate as native recovery', () => {
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

test('Spotify stays exactly behind the YouTube/TVer panel until real playback is confirmed', () => {
  assert.match(layout, /const bool compactPlayback =\s*slot\.playbackConfirmed && CurrentMusicTrack\(slot\) != nullptr/);
  assert.match(layout, /SpotifyMediaPanelRect\(parentWindow_, &mediaPanelRect\)/);
  assert.match(layout, /int x = mediaPanelRect\.left;/);
  assert.match(layout, /int y = mediaPanelRect\.top;/);
  assert.match(layout, /int width = compactPlayback \? 1 : mediaPanelWidth;/);
  assert.match(layout, /int height = compactPlayback \? 1 : mediaPanelHeight;/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM;/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
});

test('trusted click uses the media-panel background viewport and repairs accidental 1x1 placement', () => {
  assert.match(helper, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(helper, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(helper, /if \(slot\.playbackConfirmed\) \{[\s\S]*return;/);
  assert.match(helper, /const bool recoveryViewportReady = SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(helper, /GetClientRect\(slot\.hostWindow, &hostClient\)/);
  assert.match(helper, /slot\.hostLayoutApplied = false;/);
  assert.match(helper, /PlaceHosts\(\);/);
});

test('trusted click preflight ignores unrelated media but refuses a Pause control', () => {
  const preflight = helper.slice(
    helper.indexOf('void SpotifyWebViews::ClickSlotNormalizedPoint'),
    helper.indexOf('UINT SpotifyWebViews::DispatchSpotifyDevToolsClick'),
  );
  assert.match(preflight, /if \(!slot\.timedObserverReady\)/);
  assert.match(preflight, /ArmTimedEndObserver\(slot\)/);
  assert.doesNotMatch(preflight, /document\.querySelectorAll\('audio, video'\)/);
  assert.doesNotMatch(preflight, /media\.some\(m=>!m\.ended&&!m\.paused\)/);
  assert.match(preflight, /document\.elementFromPoint\(x,y\)/);
  assert.match(preflight, /testid==='play-button'\|\|testid==='control-button-playpause'/);
  assert.match(preflight, /label\.includes\('pause'\)\|\|label\.includes\('一時停止'\)/);
  assert.match(preflight, /runtime&&typeof runtime\.armTrustedStart==='function'/);
  assert.match(preflight, /ExecuteScript\(/);
  assert.match(preflight, /DispatchSpotifyDevToolsClick/);
  assert.doesNotMatch(preflight, /nextRecoveryTick = now \+ kSpotifyPlaybackStartRetryMs/);
});
