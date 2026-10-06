import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CLAIM_MINUTE_FACT_JOBS_SQL,
} from '../src/minute-facts-inbox.js';
import { saveMaterializedR2Response } from '../src/pages-response-r2.js';

const dashboardCore = readFileSync(
  new URL('../../site/functions/lib/dashboard-core.js', import.meta.url),
  'utf8',
);

test('materialized R2 writes use one raw response object with metadata', async () => {
  const writes = [];
  const result = await saveMaterializedR2Response(
    { async put(key, body, options) { writes.push({ key, body, options }); } },
    'dashboard',
    JSON.stringify({ ok: true }),
    200,
    { 'content-type': 'application/json; charset=utf-8' },
    1234,
    300,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'pages-response/v1/dashboard.json');
  assert.equal(writes[0].body, '{"ok":true}');
  assert.equal(writes[0].options.customMetadata.format, 'raw-response-v1');
  assert.equal(writes[0].options.customMetadata.updated_at, '1234');
  assert.equal(writes[0].options.customMetadata.cadence_seconds, '300');
  assert.equal(result.chunks, 1);
});

test('dashboard stale handling refuses a masked legacy DB before fallback execution', () => {
  const maskedDbGuard = dashboardCore.indexOf('if (!context.env?.DB)');
  const legacyFallback = dashboardCore.indexOf('dashboardFromBuddiesDb(context)', maskedDbGuard);
  assert.ok(maskedDbGuard >= 0);
  assert.ok(legacyFallback > maskedDbGuard);
  assert.match(dashboardCore, /status: 503/);
  assert.match(dashboardCore, /'x-dashboard-facts-stale': '1'/);
  assert.match(dashboardCore, /code: 'MINUTE_FACTS_STALE'/);
});

test('legacy D1 job claims use the due-first partial index', () => {
  assert.match(CLAIM_MINUTE_FACT_JOBS_SQL, /INDEXED BY idx_sh_minute_fact_jobs_pending_ready/);
  assert.match(
    CLAIM_MINUTE_FACT_JOBS_SQL,
    /ORDER BY next_attempt_at ASC,job_priority DESC,minute_at ASC,id ASC/,
  );
  assert.doesNotMatch(CLAIM_MINUTE_FACT_JOBS_SQL, /ORDER BY job_priority DESC,minute_at ASC/);
});
