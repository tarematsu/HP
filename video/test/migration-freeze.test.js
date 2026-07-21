import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { migrationFreezeEnabled } from '../src/entry.js';

test('migration freeze flag accepts only true-like text', () => {
  assert.equal(migrationFreezeEnabled({ VIDEO_MIGRATION_FREEZE: 'true' }), true);
  assert.equal(migrationFreezeEnabled({ VIDEO_MIGRATION_FREEZE: ' TRUE ' }), true);
  assert.equal(migrationFreezeEnabled({ VIDEO_MIGRATION_FREEZE: 'false' }), false);
  assert.equal(migrationFreezeEnabled({}), false);
});

test('migration freeze rejects API traffic without touching D1', async () => {
  const response = await worker.fetch(
    new Request('https://video.example/api/status'),
    { VIDEO_MIGRATION_FREEZE: 'true' },
    {}
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '300');
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Video data migration is in progress',
    retryable: true
  });
});

test('migration freeze suppresses queue and scheduled writes', async () => {
  const env = { VIDEO_MIGRATION_FREEZE: 'true' };
  await worker.queue({ messages: [{ id: 'one' }] }, env, {});
  await worker.scheduled({ cron: '*/12 * * * *' }, env, { waitUntil() {} });
});
