import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../../.github/workflows/sh-live-js-audit.yml', import.meta.url),
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

test('live Stationhead CI measures the actual Start Listening surface directly', () => {
  assert.match(workflow, /Measure Start Listening visibility/);
  assert.match(workflow, /measure-stationhead-start-listening\.mjs/);
  assert.match(workflow, /--attempts=3/);
  assert.doesNotMatch(workflow, /audit-stationhead-js-live\.mjs/);
  assert.doesNotMatch(workflow, /audit-stationhead-svg-icon-reduction-live\.mjs/);
  assert.doesNotMatch(workflow, /inspect-stationhead-module-graph\.mjs/);
});

test('credentials use audit secrets while the report stays metadata-only', () => {
  assert.match(workflow, /secrets\.STATIONHEAD_AUDIT_EMAIL/);
  assert.match(workflow, /secrets\.STATIONHEAD_AUDIT_PASSWORD/);
  assert.match(workflow, /Attempt Stationhead credential login/);
  assert.match(loginAudit, /musicModalCloseClicked/);
  assert.match(loginAudit, /click\(\{\s*timeout: 5000,\s*force: true/);
  assert.match(loginAudit, /loginNavigationUsed/);
  assert.match(loginAudit, /page\.goto\(loginUrl/);
  assert.match(loginAudit, /emailInputVisible/);
  assert.match(loginAudit, /passwordInputVisible/);
  assert.doesNotMatch(loginAudit, /console\.(?:log|error)\([^\n]*(?:emailValue|passwordValue|STATIONHEAD_PASSWORD)/);
  assert.doesNotMatch(loginAudit, /JSON\.stringify\([^\n]*(?:emailValue|passwordValue)/);
});

test('authenticated audit observes real streakStats without storing its body', () => {
  assert.match(loginAudit, /isStreakStatsUrl/);
  assert.match(loginAudit, /page\.on\('response'/);
  assert.match(loginAudit, /production1\.stationhead\.com/);
  assert.match(loginAudit, /streakStatsSeen/);
  assert.match(loginAudit, /streakStatsStatus/);
  assert.match(loginAudit, /streakStatsValid/);
  assert.match(loginAudit, /streakStatsPointCount/);
  assert.match(loginAudit, /postLoginStationProbe/);
  assert.match(loginAudit, /Array\.isArray\(payload\?\.chart_data\)/);
  assert.doesNotMatch(loginAudit, /report\.streakStats(?:Body|Payload|Response)\s*=/);
});

test('workflow gate checks reachability and startup budget instead of obsolete replacements', () => {
  const gate = section(workflow, '- name: Enforce Stationhead UI audit', 'NODE\n');
  assert.match(gate, /timing\.visibleCount !== timing\.sampleCount/);
  assert.match(gate, /timing\.p95VisibleAfterMs/);
  assert.match(gate, /> 5000/);
  assert.doesNotMatch(gate, /missedInterceptions/);
  assert.doesNotMatch(gate, /svgIconIntercepted|premiumIconRequested|report\.passed/);
  assert.doesNotMatch(gate, /audio\.paused|playbackState|mediaSession|HTMLMediaElement/);
});
