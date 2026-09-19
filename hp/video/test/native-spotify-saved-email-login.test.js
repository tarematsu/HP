import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const foundation = readFileSync(
  new URL('../../native/src/spotify_webview_foundation.inc', import.meta.url),
  'utf8',
);
const helper = readFileSync(
  new URL('../../native/src/spotify_saved_email_login.h', import.meta.url),
  'utf8',
);
const featurePolicy = readFileSync(
  new URL('../../native/src/webview_feature_policy.h', import.meta.url),
  'utf8',
);

test('Spotify auth invokes saved-email automation from the shared WebView lifecycle', () => {
  assert.match(foundation, /#include "spotify_saved_email_login\.h"/);
  assert.match(foundation, /TrySpotifySavedEmailLogin\(webview\.Get\(\)\)/);
  assert.match(featurePolicy, /put_IsGeneralAutofillEnabled\(TRUE\)/);
});

test('saved-email automation is limited to Spotify authentication pages and email inputs', () => {
  assert.match(helper, /https:\/\/accounts\.spotify\.com\//);
  assert.match(helper, /https:\/\/challenge\.spotify\.com\//);
  assert.match(helper, /https:\/\/open\.spotify\.com\/login/);
  assert.ok(helper.includes('input[type=\\"email\\"]'));
  assert.ok(helper.includes('input[autocomplete=\\"username\\"]'));
  assert.match(helper, /__hpSpotifySavedEmailLoginAttempted/);
});

test('saved browser suggestion is selected with trusted CDP input instead of a hard-coded address', () => {
  assert.match(helper, /Input\.dispatchMouseEvent/);
  assert.match(helper, /Input\.dispatchKeyEvent/);
  assert.match(helper, /ArrowDown/);
  assert.match(helper, /Enter/);
  assert.doesNotMatch(helper, /Input\.insertText/);
  assert.doesNotMatch(helper, /@gmail\.com|@yahoo\.co\.jp|@outlook\.com/i);
});

test('continue is clicked only after the remembered email value is populated', () => {
  assert.match(helper, /String\(input\.value \|\| ''\)\.trim\(\)/);
  assert.ok(helper.includes('button[type=\\"submit\\"], input[type=\\"submit\\"]'));
  assert.match(helper, /label === 'continue'/);
  assert.match(helper, /label === '続行'/);
  assert.match(helper, /button\.click\(\)/);
});
