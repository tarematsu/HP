import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const interaction = source('sh_runtime_interaction_script.h');
const onboarding = source('sh_runtime_onboarding_script.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('recoverable onboarding ignores standalone login header while preserving hard login guards', () => {
  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );

  // Reconnect Music / Continue must not be suppressed merely because the page
  // also exposes the ordinary unauthenticated Log in header control.
  assert.match(publish, /if \(blockingLogin\(true\)\) return false;/);
  assert.doesNotMatch(publish, /blockingLogin\(accountVisible\(\)\)/);
  assert.doesNotMatch(publish, /blockingLogin\(authenticated\)/);

  // The shared blocker still keeps genuine login routes and credential forms
  // out of the auto-click path even when called with authenticated=true.
  const blocker = section(
    interaction,
    'const blockingLogin = authenticated => {',
    'const cancelAuthReady = () => {',
  );
  assert.match(blocker, /if \(loginRoute\(\)\) return true;/);
  assert.match(blocker, /document\.querySelectorAll\(credentialSelector\)/);
  assert.match(blocker, /if \(visible\(input\)\) return true;/);
  assert.match(blocker, /shell && visible\(shell\)/);
});
