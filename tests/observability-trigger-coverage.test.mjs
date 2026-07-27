import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function triggerSection(workflow) {
  const permissions = workflow.indexOf('\npermissions:');
  assert.notEqual(permissions, -1);
  return workflow.slice(0, permissions);
}

test('all observability helpers trigger dedicated contract CI', () => {
  const trigger = triggerSection(read('.github/workflows/homepanel-unified-ci.yml'));
  assert.match(trigger, /\.github\/scripts\/observability-\*\.mjs/);
  assert.match(trigger, /\.github\/scripts\/publish-cloudflare-observability-status\.mjs/);
});

test('all observability helpers refresh the production status issue', () => {
  const trigger = triggerSection(read('.github/workflows/sh-observability.yml'));
  assert.match(trigger, /\.github\/scripts\/observability-\*\.mjs/);
  assert.match(trigger, /\.github\/scripts\/publish-cloudflare-observability-status\.mjs/);
});

test('the D1 trend helper is covered by both wildcard contracts', () => {
  const helper = '.github/scripts/observability-daily-trend.mjs';
  assert.match(helper, /^\.github\/scripts\/observability-.*\.mjs$/);
});
