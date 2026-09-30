import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publisher = readFileSync(new URL('../src/pages-dashboard-live-publisher.js', import.meta.url), 'utf8');
const fastStore = readFileSync(new URL('../src/minute-facts-fast-store.js', import.meta.url), 'utf8');
const detailsClient = readFileSync(new URL('../../site/public/dashboard-details-client.js', import.meta.url), 'utf8');

test('committed live minute facts immediately publish the current dashboard model', () => {
  assert.match(fastStore, /await timedStage\('upsert_minute_fact'/);
  assert.match(fastStore, /await publishCurrentDashboard\(env, input, fact\)/);
  assert.match(publisher, /pagesActionsR2ResponseKey\('dashboard'\)/);
  assert.match(publisher, /bucket\.get\(DASHBOARD_KEY\)/);
  assert.match(publisher, /bucket\.put\(DASHBOARD_KEY/);
  assert.match(publisher, /directFiveMinuteStreamHistory\(history\)/);
});

test('steady-state live publication is differential and reserves full D1 rendering for sparse checkpoints', () => {
  assert.match(publisher, /const FULL_REFRESH_MS = 6 \* 60 \* 60_000/);
  assert.match(publisher, /needsFullRefresh/);
  assert.match(publisher, /incrementalPayload\(base, input, fact/);
  assert.match(publisher, /full_render: full/);
  assert.doesNotMatch(publisher, /FROM sh_minute_facts|FROM sh_dashboard_history_5m/);
});

test('current-tab client does not issue a details D1 request when the materialized model already embeds details', () => {
  assert.match(detailsClient, /function embeddedDetails\(/);
  assert.match(detailsClient, /if \(embedded\) \{/);
  assert.match(detailsClient, /return;\n  \}/);
  assert.match(detailsClient, /fetch\(`\/api\/dashboard-details\?channel_id=/);
});
