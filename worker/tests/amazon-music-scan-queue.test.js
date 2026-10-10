import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAmazonMusicScan, consumeAmazonMusicScans } from '../src/amazon-music-scan-queue.js';
test('long scans are enqueued and a failed consumer retries without acknowledging', async () => {
  let body;
  await enqueueAmazonMusicScan({ MUSIC_PLAYLIST_QUEUE: { send: async (message) => { body = message; } } }, 1000, true);
  let ack = 0; let retry = 0;
  const entry = { body, ack: () => ack++, retry: () => retry++ };
  const other = { body: { message_type: 'spotify-playlists' } };
  const remaining = await consumeAmazonMusicScans({ messages: [entry, other] }, {}, async () => { throw new Error('provider unavailable'); });
  assert.deepEqual(remaining, [other]);
  assert.equal(ack, 0); assert.equal(retry, 1);
  await consumeAmazonMusicScans({ messages: [entry] }, {}, async (_env, time, options) => { assert.equal(time, 1000); assert.equal(options.start, true); });
  assert.equal(ack, 1);
});
