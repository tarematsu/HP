import assert from 'node:assert/strict';
import test from 'node:test';
import app, { runRegionalMusicServiceQueue, YOUTUBE_MUSIC_QUEUE_MESSAGE_TYPE } from '../src/regional-music-service-entry.js';
import { YOUTUBE_MUSIC_DAILY_CRON } from '../src/regional-music-entry.js';
import { parseRegionalServiceSelection } from '../scripts/collect-regional-r2-actions.mjs';

test('YouTube scheduled HTTP dispatch only enqueues the long-running collection', async () => {
  const sent = [];
  const result = await app.scheduled({ cron: YOUTUBE_MUSIC_DAILY_CRON, scheduledTime: 1000 }, {
    REGIONAL_MUSIC_QUEUE: { async send(body) { sent.push(body); } },
  }, { waitUntil() { assert.fail('collection must not depend on HTTP background lifetime'); } });
  assert.equal(result.queued, true);
  assert.deepEqual(sent, [{ message_type: YOUTUBE_MUSIC_QUEUE_MESSAGE_TYPE, message_version: 1, scheduled_at: 1000 }]);
  assert.deepEqual(parseRegionalServiceSelection(['--services=youtube_music']), ['youtube_music']);
});

test('YouTube queue acknowledges successful R2 publication and retries incomplete collection', async () => {
  let acknowledgements = 0;
  const batch = { messages: [{ body: { message_type: YOUTUBE_MUSIC_QUEUE_MESSAGE_TYPE, message_version: 1, scheduled_at: 1000 }, ack() { acknowledgements++; } }] };
  const collectServiceToR2 = async (service, env, at) => {
    assert.equal(service, 'youtube_music');
    assert.equal(at, 1000);
    return { snapshot_status: 'ok' };
  };
  await runRegionalMusicServiceQueue(batch, {}, {}, { collectServiceToR2 });
  assert.equal(acknowledgements, 1);
  await assert.rejects(runRegionalMusicServiceQueue(batch, {}, {}, {
    collectServiceToR2: async () => ({ snapshot_status: 'error' }),
  }), /did not complete successfully/);
  assert.equal(acknowledgements, 1, 'failed collection remains unacknowledged');
});
