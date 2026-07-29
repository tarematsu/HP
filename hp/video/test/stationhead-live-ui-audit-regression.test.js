import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../../.github/workflows/sh-live-js-audit.yml', import.meta.url),
  'utf8',
);
const audit = readFileSync(
  new URL('../../../scripts/audit-stationhead-js-live.mjs', import.meta.url),
  'utf8',
);
const loginAudit = readFileSync(
  new URL('../../../scripts/audit-stationhead-login.mjs', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('replaced Stationhead page requires a visible Start Listening control and post-click screen', () => {
  const summary = section(audit, 'function summarize(', 'function markdown(');
  assert.match(summary, /blocked\.ui\.startListeningVisible/);
  assert.match(summary, /blocked\.ui\.clicked/);
  assert.match(summary, /blocked\.ui\.afterClickScreenVisible/);
  assert.match(summary, /const passed = Boolean/);
  assert.doesNotMatch(summary, /audio|media|playbackState|HTMLMediaElement/);
});

test('UI audit captures evidence before credentials can be entered', () => {
  const capture = section(audit, 'async function runCapture(', 'function summarize(');
  assert.match(capture, /\$\{captureName\}-before-click\.png/);
  assert.match(capture, /\$\{captureName\}-after-click\.png/);
  const screenshotAt = capture.indexOf('`${captureName}-after-click.png`');
  const loginAt = capture.indexOf('attemptCredentialLogin(page, credentials)');
  assert.ok(screenshotAt >= 0 && screenshotAt < loginAt);
  assert.match(capture, /const finalState = ui\.after \|\| ui\.before/);
});

test('credentials use the existing audit secrets and never enter reports', () => {
  assert.match(workflow, /secrets\.STATIONHEAD_AUDIT_EMAIL/);
  assert.match(workflow, /secrets\.STATIONHEAD_AUDIT_PASSWORD/);
  assert.match(workflow, /Attempt Stationhead credential login/);
  assert.match(loginAudit, /page\.keyboard\.press\('Escape'\)/);
  assert.match(loginAudit, /loginControlClicked/);
  assert.match(loginAudit, /emailInputVisible/);
  assert.match(loginAudit, /passwordInputVisible/);
  assert.doesNotMatch(loginAudit, /console\.(?:log|error)\([^\n]*(?:emailValue|passwordValue|STATIONHEAD_PASSWORD)/);
  assert.doesNotMatch(loginAudit, /JSON\.stringify\([^\n]*(?:emailValue|passwordValue)/);
});

test('workflow always runs both pages and has an authoritative UI gate', () => {
  assert.match(workflow, /Audit primary Stationhead page[\s\S]*continue-on-error: true/);
  assert.match(workflow, /Audit fallback Stationhead page[\s\S]*if: always\(\)[\s\S]*continue-on-error: true/);
  const gate = section(workflow, '- name: Enforce Stationhead UI audit', 'NODE\n');
  assert.match(gate, /ui\.startListeningVisible/);
  assert.match(gate, /ui\.clicked/);
  assert.match(gate, /ui\.afterClickScreenVisible/);
  assert.match(gate, /report\.passed !== true/);
  assert.doesNotMatch(gate, /audio\.paused|playbackState|mediaSession|HTMLMediaElement/);
});
