import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import deployedWorker from '../worker/src/runtime-orchestrator-deployed-entry.js';
import { runD1CoordinatedScheduled } from '../worker/src/runtime-d1-coordinator.js';
import {
  TRACK_HISTORY_RESPONSE_MAX_CHUNKS,
} from '../worker/src/pages-track-history-response.js';

test('deployed runtime uses D1 coordination', async () => {
  assert.deepEqual(Object.keys(deployedWorker).sort(), ['fetch', 'queue', 'scheduled']);
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async first() { return { holder_id: 'holder-1', lease_until: 80_000 }; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
  const result = await runD1CoordinatedScheduled(
    { cron: '* * * * *', scheduledTime: 123 },
    { BUDDIES_DB: db },
    {},
    async () => 'ok',
    { now: 1_000, holderId: 'holder-1' },
  );
  assert.equal(result, 'ok');
  assert.match(statements[0], /INSERT INTO sh_runtime_run_lease/);
  assert.match(statements[1], /UPDATE sh_runtime_run_lease/);

  const config = JSON.parse(readFileSync(
    new URL('../worker/wrangler.runtime.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.main, 'src/runtime-orchestrator-deployed-entry.js');
});

test('track-history response capacity covers the production publication', () => {
  assert.equal(TRACK_HISTORY_RESPONSE_MAX_CHUNKS, 256);
  assert.ok(TRACK_HISTORY_RESPONSE_MAX_CHUNKS > 80);
});
