import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const policy = source('webview_feature_policy.h');
const stationhead = source('sh_webview.cpp');
const spotify = source('spotify_controller_lifecycle.inc');
const media = source('renderer_panels/media_host.inc');

test('all media WebViews use the shared minimal feature policy', () => {
  assert.match(stationhead, /ApplyMediaWebViewFeaturePolicy\(webview_\.Get\(\), true\)/);
  assert.match(stationhead, /ApplyMediaWebViewFeaturePolicy\(authWebview_\.Get\(\), true\)/);
  assert.match(spotify, /ApplyMediaWebViewFeaturePolicy\(slot\.webview\.Get\(\), true\)/);
  assert.match(media, /ApplyMediaWebViewFeaturePolicy\(webview_\.Get\(\), false\)/);
});

test('shared policy disables optional browser UI but retains native automation', () => {
  for (const setting of [
    'AreDefaultScriptDialogsEnabled',
    'AreDefaultContextMenusEnabled',
    'AreDevToolsEnabled',
    'IsStatusBarEnabled',
    'AreHostObjectsAllowed',
    'IsZoomControlEnabled',
    'IsBuiltInErrorPageEnabled',
    'AreBrowserAcceleratorKeysEnabled',
    'IsPinchZoomEnabled',
    'IsSwipeNavigationEnabled',
  ]) {
    assert.match(policy, new RegExp(`put_${setting}\\(FALSE\\)`));
  }
  assert.match(policy, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(policy, /put_IsWebMessageEnabled\(webMessagesEnabled \? TRUE : FALSE\)/);
});

test('shared policy keeps remembered form input and password saving enabled', () => {
  assert.match(policy, /put_IsPasswordAutosaveEnabled\(TRUE\)/);
  assert.match(policy, /put_IsGeneralAutofillEnabled\(TRUE\)/);
  assert.doesNotMatch(policy, /put_IsPasswordAutosaveEnabled\(FALSE\)/);
  assert.doesNotMatch(policy, /put_IsGeneralAutofillEnabled\(FALSE\)/);
});
