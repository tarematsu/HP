import assert from 'node:assert/strict';
import test from 'node:test';

import { createShTrafficGuard } from '../src/sh-traffic-guard.js';

const ORIGIN = 'https://production1.stationhead.com';

function okJson() {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}

test('station handle reads keep a reserved budget after data reads are exhausted', async () => {
  const calls = [];
  const guarded = createShTrafficGuard(async (input) => {
    calls.push(new URL(String(input)).pathname);
    return okJson();
  }, () => 0);

  for (let index = 0; index < 10; index += 1) {
    const response = await guarded(`${ORIGIN}/channels/alias/buddies?sample=${index}`);
    assert.equal(response.status, 200);
  }

  const buddy = await guarded(`${ORIGIN}/station/handle/buddy46/guest`, {
    method: 'POST',
    body: '',
  });

  assert.equal(buddy.status, 200);
  assert.equal(calls.length, 11);
  assert.equal(calls.at(-1), '/station/handle/buddy46/guest');
});

test('station handle reads still have their own per-minute limit', async () => {
  const calls = [];
  const guarded = createShTrafficGuard(async (input) => {
    calls.push(new URL(String(input)).pathname);
    return okJson();
  }, () => 0);

  assert.equal((await guarded(`${ORIGIN}/station/handle/buddy46/guest`, { method: 'POST', body: '' })).status, 200);
  assert.equal((await guarded(`${ORIGIN}/station/handle/sakurazaka46jp/guest`, { method: 'POST', body: '' })).status, 200);

  const blocked = await guarded(`${ORIGIN}/station/handle/third/guest`, {
    method: 'POST',
    body: '',
  });

  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('x-sh-traffic-guard'), 'station-minute-budget-exhausted');
  assert.deepEqual(calls, [
    '/station/handle/buddy46/guest',
    '/station/handle/sakurazaka46jp/guest',
  ]);
});

test('Stationhead auth requests are pinned to the ILYS page context only', async () => {
  const calls = [];
  const guarded = createShTrafficGuard(async (input, init) => {
    calls.push({
      path: new URL(String(input)).pathname,
      referer: new Headers(init?.headers).get('referer'),
    });
    return okJson();
  }, () => 0);

  await guarded(`${ORIGIN}/web/token`, {
    method: 'POST',
    body: '',
    headers: { referer: 'https://www.stationhead.com/' },
  });
  await guarded(`${ORIGIN}/channels/alias/buddies`, {
    headers: { referer: 'https://www.stationhead.com/' },
  });

  assert.deepEqual(calls, [
    { path: '/web/token', referer: 'https://www.stationhead.com/c/ilys' },
    { path: '/channels/alias/buddies', referer: 'https://www.stationhead.com/' },
  ]);
});

test('cached Stationhead reads are rebuilt from detached bytes instead of cloning the source response', async () => {
  let calls = 0;
  const guarded = createShTrafficGuard(async () => {
    calls += 1;
    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'clone', {
      value() {
        throw new Error('source Response must not be retained or cloned');
      },
    });
    return response;
  }, () => 60_001);

  const first = await guarded(`${ORIGIN}/channels/alias/buddies`);
  const second = await guarded(`${ORIGIN}/channels/alias/buddies`);

  assert.deepEqual(await first.json(), { ok: true });
  assert.deepEqual(await second.json(), { ok: true });
  assert.equal(calls, 1);
});
