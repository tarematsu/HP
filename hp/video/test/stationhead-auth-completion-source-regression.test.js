import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const processPolicy = readFileSync(
  new URL('../../native/src/sh_auth_process_failure_policy_fix.h', import.meta.url),
  'utf8',
);
const completionPolicy = readFileSync(
  new URL('../../native/src/sh_auth_completion_message_policy_fix.h', import.meta.url),
  'utf8',
);
const eventPolicy = readFileSync(
  new URL('../../native/src/sh_webview_event_policy.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

test('auth completion source policy is loaded after process-failure stabilization', () => {
  const macroAt = processPolicy.indexOf('#define add_ProcessFailed');
  const includeAt = processPolicy.indexOf(
    '#include "sh_auth_completion_message_policy_fix.h"',
  );
  assert.ok(macroAt >= 0 && includeAt > macroAt);
});

test('only terminal Spotify auth messages receive the Stationhead-only gate', () => {
  assert.match(completionPolicy, /type == L"spotify-connected"/);
  assert.match(completionPolicy, /type == L"spotify-error"/);
  assert.match(
    completionPolicy,
    /IsStationheadAuthCompletionMessage\(args\)[\s\S]*!HasStationheadAuthCompletionSource\(args\)/,
  );
  assert.match(
    completionPolicy,
    /InvokeEventNoexcept\([\s\S]*inner, sender, args\)/,
  );
});

test('terminal auth messages require an HTTPS Stationhead sender', () => {
  assert.match(completionPolicy, /args->get_Source\(&sourceRaw\)/);
  assert.match(completionPolicy, /CrackHttpsOrigin\(sourceRaw, origin\)/);
  assert.match(completionPolicy, /IsStationheadHost\(origin\.host\)/);
  assert.doesNotMatch(
    completionPolicy,
    /HasStationheadAuthCompletionSource[\s\S]*IsSpotifyHost/,
  );
});

test('final message registration retains the exact-current-origin boundary', () => {
  assert.match(
    completionPolicy,
    /WrapStationheadWebMessageHandler\([\s\S]*WrapStationheadAuthCompletionMessageHandler/,
  );
  assert.match(
    eventPolicy,
    /SameTrustedMessageOrigin\(messageSource, currentSource\)/,
  );
});

test('existing playback string messages and auth handler ownership stay unchanged', () => {
  assert.match(
    webviewSource,
    /type != L"spotify-connected" && type != L"spotify-error"/,
  );
  assert.match(webviewSource, /primary-playing|secondary-playing/);
  assert.doesNotMatch(
    completionPolicy,
    /Navigate\(|Reload\(|Close\(|FinishSpotifyAuthorization/,
  );
});
