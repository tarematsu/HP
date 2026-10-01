import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGIONAL_MUSIC_DAILY_SERVICES,
  REGIONAL_MUSIC_DISPATCH_UTC_HOUR,
  enqueueRegionalMusicDispatch,
  regionalMusicDispatchForTimestamp,
} from '../src/regional-music-dispatch-plan.js';

test('regional services dispatch one per minute from 06:00 through 06:18 JST', () => {
  assert.equal(REGIONAL_MUSIC_DAILY_SERVICES.length, 19);
  assert.equal(new Set(REGIONAL_MUSIC_DAILY_SERVICES).size, 19);
  assert.equal(REGIONAL_MUSIC_DISPATCH_UTC_HOUR, 21);

  const base = Date.UTC(2026, 9, 1, 21, 0, 0);
  const messages = REGIONAL_MUSIC_DAILY_SERVICES.map((service, minute) => {
    const message = regionalMusicDispatchForTimestamp(base + minute * 60_000);
    assert.equal(message.message_type, 'regional-music-collect');
    assert.equal(message.service, service);
    return message;
  });
  assert.equal(messages.length, 19);
  assert.equal(regionalMusicDispatchForTimestamp(base + 19 * 60_000), null);
});

test('regional scheduler has no fixed-time read-model publication', () => {
  assert.equal(regionalMusicDispatchForTimestamp(Date.UTC(2026, 9, 1, 21, 30, 0)), null);
  assert.equal(regionalMusicDispatchForTimestamp(Date.UTC(2026, 9, 1, 20, 30, 0)), null);
});

test('shared scheduler sends only due regional queue messages', async () => {
  const sent = [];
  const env = { REGIONAL_MUSIC_QUEUE: { send: async (body) => sent.push(body) } };
  const due = Date.UTC(2026, 9, 1, 21, 5, 0);
  const idle = Date.UTC(2026, 9, 1, 22, 5, 0);

  const message = await enqueueRegionalMusicDispatch(env, due);
  assert.equal(message.service, REGIONAL_MUSIC_DAILY_SERVICES[5]);
  assert.equal(sent.length, 1);
  assert.equal(await enqueueRegionalMusicDispatch(env, idle), null);
  assert.equal(sent.length, 1);
});
