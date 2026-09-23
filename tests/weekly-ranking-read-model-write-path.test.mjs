import assert from 'node:assert/strict';
import test from 'node:test';

import { createWranglerRemoteD1 } from '../worker/scripts/remote-d1-adapter.mjs';

const resultJson = (entries) => JSON.stringify(entries);

test('large weekly ranking payload uses Wrangler --file path', async () => {
  let argsSeen = null;
  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: process.cwd(),
    wranglerScript: '/tmp/wrangler.js',
    maxCommandBytes: 1024,
    execFileSync(_command, args) {
      argsSeen = args;
      return resultJson([{ success: true, results: [], meta: { changes: 1 } }]);
    },
  });
  const payload = JSON.stringify({ completed_rows: Array.from({ length: 500 }, (_, i) => ({ i, host: `host-${i}` })) });
  await db.prepare('INSERT INTO sh_weekly_ranking_read_model(id,payload_json) VALUES(1,?1)').bind(payload).run();
  assert.equal(argsSeen.includes('--file'), true);
  assert.equal(argsSeen.includes('--command'), false);
});
