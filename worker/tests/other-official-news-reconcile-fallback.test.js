import assert from 'node:assert/strict';
import test from 'node:test';

import { processOfficialNewsStage } from '../src/other-official-news-stages.js';

const BASE = Date.UTC(2026, 0, 1, 0, 20, 0);

test('raw materialization queues reconcile only when inline reconcile fails', async () => {
  const sent = [];
  let materializeCalls = 0;
  const result = await processOfficialNewsStage({}, {
    stage: 'raw-materialize',
    scheduledAt: BASE,
    afterNewsCheck: false,
  }, {
    rawMaterialize: async () => {
      materializeCalls += 1;
      return { skipped: false, active: true, session_id: 12, station_id: 34 };
    },
    reconcile: async () => {
      throw new Error('temporary reconcile failure');
    },
    send: async (message) => sent.push(message),
  });

  assert.equal(materializeCalls, 1);
  assert.equal(result.pending, true);
  assert.equal(result.next_stage, 'reconcile');
  assert.equal(result.reconciled, false);
  assert.equal(result.reconcile_deferred, true);
  assert.equal(result.session_id, 12);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stage, 'reconcile');
  assert.equal(sent[0].scheduled_at, BASE);
});
