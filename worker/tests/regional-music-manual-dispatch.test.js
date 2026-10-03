import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRegionalRecollection } from '../scripts/recollect-regional-music-actions.mjs';

test('manual collection targets the configured queue and all active regional services with a fresh timestamp', async () => {
  const calls = [];
  const result = await dispatchRegionalRecollection({
    config: { queues: { consumers: [{ queue: 'regional-music-daily' }] } },
    now: 123456,
    api: async (path, body) => {
      if (!body) return [{ queue_name: 'other', queue_id: 'wrong' }, { queue_name: 'regional-music-daily', queue_id: 'target' }];
      calls.push({ path, body });
      return {};
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.body.body.service)).size, 3);
  assert.deepEqual(result.services, ['kkbox','qq_music','kugou_music']);
  assert.ok(calls.every((call) => call.path === '/queues/target/messages' && call.body.body.scheduled_at === 123456 && call.body.content_type === 'json'));
  assert.equal(result.services.includes('youtube_music'), false);
});
