import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = path => readFileSync(
  new URL(`../../native/src/${path}`, import.meta.url),
  'utf8',
);

const updater = native('updater_entry.cpp');
const clickers = new Map([
  ['Stationhead onboarding', native('sh_onboarding_click_policy.h')],
  ['Stationhead playback', native('sh_script_blocking_extension.h')],
  ['Spotify playback', native('spotify_background_click.inc')],
  ['Spotify saved-email login', native('spotify_saved_email_login.h')],
  ['media trusted input', native('renderer_panels/media_trusted_input.inc')],
  ['media host', native('renderer_panels/media_host.inc')],
]);

test('foreground updater dialogs cannot gate WebView trusted auto-click dispatch', () => {
  assert.match(updater, /MB_TOPMOST\s*\|\s*MB_SETFOREGROUND/);

  const foregroundDependentInput =
    /\bGetForegroundWindow\b|\bSetForegroundWindow\b|\bSendInput\b|\bmouse_event\b|\bWM_LBUTTON(?:DOWN|UP)\b/;

  for (const [name, source] of clickers) {
    assert.match(source, /Input\.dispatchMouseEvent/, `${name} must use CDP input`);
    assert.doesNotMatch(
      source,
      foregroundDependentInput,
      `${name} auto-click must not depend on foreground-window ownership`,
    );
  }
});
