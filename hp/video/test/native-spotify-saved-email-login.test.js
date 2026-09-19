import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = readFileSync(
  new URL('../../native/src/spotify_saved_email_login.h', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.cpp', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const scheduler = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const foundation = readFileSync(
  new URL('../../native/src/spotify_webview_foundation.inc', import.meta.url),
  'utf8',
);
const featurePolicy = readFileSync(
  new URL('../../native/src/webview_feature_policy.h', import.meta.url),
  'utf8',
);

test('Spotify saved-email auth is separate from audio routing and uses browser autofill', () => {
  assert.match(wrapper, /#include "spotify_saved_email_login\.h"/);
  assert.doesNotMatch(foundation, /TrySpotifySavedEmailLogin/);
  assert.match(featurePolicy, /put_IsGeneralAutofillEnabled\(TRUE\)/);
  assert.doesNotMatch(helper, /Input\.insertText/);
  assert.doesNotMatch(helper, /@gmail\.com|@yahoo\.co\.jp|@outlook\.com/i);
});

test('email login helper only targets Spotify email-login surfaces', () => {
  assert.match(helper, /https:\/\/accounts\.spotify\.com\//);
  assert.match(helper, /https:\/\/open\.spotify\.com\/login/);
  assert.doesNotMatch(helper, /https:\/\/challenge\.spotify\.com\//);
  assert.ok(helper.includes('input[type="email"]'));
  assert.ok(helper.includes('input[autocomplete="username"]'));
});

test('saved suggestion and Continue both use trusted CDP input', () => {
  assert.match(helper, /Input\.dispatchMouseEvent/);
  assert.match(helper, /Input\.dispatchKeyEvent/);
  assert.match(helper, /ArrowDown/);
  assert.match(helper, /Enter/);
  assert.match(helper, /action == 1/);
  assert.match(helper, /return \[2, point\[0\], point\[1\]\]/);
  assert.doesNotMatch(helper, /button\.click\(\)/);
});

test('auth assist retries are bounded and reset by Spotify page epoch', () => {
  assert.match(header, /authAssistPageEpoch/);
  assert.match(header, /nextAuthAssistTick/);
  assert.match(header, /authAssistAttempts/);
  assert.match(phase, /kSpotifyAuthAssistRetryMs = 500ULL/);
  assert.match(phase, /kSpotifyAuthAssistMaxAttempts = 60U/);
  assert.match(phase, /slot\.authAssistPageEpoch != slot\.pageEpoch/);
  assert.match(phase, /considerTick\(slot\.nextAuthAssistTick\)/);
  assert.match(scheduler, /authSlot\.authAssistPageEpoch != authSlot\.pageEpoch/);
  assert.match(scheduler, /TrySpotifySavedEmailLogin\(authSlot\.webview\.Get\(\)\)/);
  assert.match(scheduler, /authSlot\.authAssistAttempts < kSpotifyAuthAssistMaxAttempts/);
});
