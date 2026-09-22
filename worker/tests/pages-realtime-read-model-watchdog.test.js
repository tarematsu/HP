import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAGES_REALTIME_DISPATCH_COOLDOWN_MS,
  PAGES_REALTIME_READ_MODEL_WATCHDOG,
  PAGES_REALTIME_STALE_AFTER_MS,
  pagesRealtimeWatchdogDue,
  runPagesRealtimeReadModelWatchdog,
} from '../src/pages-realtime-read-model-watchdog.js';

const NOW = Date.UTC(2026, 8, 22, 1, 0, 0);

function r2Bucket({ dashboardUploadedAt = null, markerUploadedAt = null } = {}) {
  const heads = [];
  const puts = [];
  return {
    heads,
    puts,
    async head(key) {
      heads.push(key);
      if (key === PAGES_REALTIME_READ_MODEL_WATCHDOG.dashboard_object_key) {
        return dashboardUploadedAt === null ? null : { uploaded: new Date(dashboardUploadedAt) };
      }
      if (key === PAGES_REALTIME_READ_MODEL_WATCHDOG.dispatch_marker_key) {
        return markerUploadedAt === null ? null : { uploaded: new Date(markerUploadedAt) };
      }
      return null;
    },
    async put(key, body, options) {
      puts.push({ key, body, options });
    },
  };
}

test('watchdog only checks one existing per-minute cron slot out of five', () => {
  assert.equal(pagesRealtimeWatchdogDue(NOW), true);
  assert.equal(pagesRealtimeWatchdogDue(NOW + 60_000), false);
  assert.equal(pagesRealtimeWatchdogDue(NOW + 4 * 60_000), false);
  assert.equal(pagesRealtimeWatchdogDue(NOW + 5 * 60_000), true);
});

test('healthy dashboard performs one R2 HEAD and no dispatch', async () => {
  const bucket = r2Bucket({ dashboardUploadedAt: NOW - 3 * 60_000 });
  let fetches = 0;
  const result = await runPagesRealtimeReadModelWatchdog({ PAGES_RESPONSE_R2: bucket }, {
    scheduledAt: NOW,
    now: () => NOW,
    fetcher: async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.status, 'fresh');
  assert.equal(fetches, 0);
  assert.deepEqual(bucket.heads, [PAGES_REALTIME_READ_MODEL_WATCHDOG.dashboard_object_key]);
  assert.equal(bucket.puts.length, 0);
});

test('stale dashboard dispatches the existing GitHub workflow and writes a cooldown marker', async () => {
  const bucket = r2Bucket({
    dashboardUploadedAt: NOW - PAGES_REALTIME_STALE_AFTER_MS - 1,
  });
  const requests = [];
  const result = await runPagesRealtimeReadModelWatchdog({
    PAGES_RESPONSE_R2: bucket,
    PAGES_READ_MODEL_DISPATCH_TOKEN: 'test-token',
  }, {
    scheduledAt: NOW,
    now: () => NOW,
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.status, 'dispatched');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /refresh-pages-realtime\.yml\/dispatches$/);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), { ref: 'main' });
  assert.equal(bucket.puts.length, 1);
  assert.equal(bucket.puts[0].key, PAGES_REALTIME_READ_MODEL_WATCHDOG.dispatch_marker_key);
});

test('recent dispatch marker suppresses a stale refresh storm', async () => {
  const bucket = r2Bucket({
    dashboardUploadedAt: NOW - PAGES_REALTIME_STALE_AFTER_MS - 1,
    markerUploadedAt: NOW - PAGES_REALTIME_DISPATCH_COOLDOWN_MS + 60_000,
  });
  let fetches = 0;
  const result = await runPagesRealtimeReadModelWatchdog({
    PAGES_RESPONSE_R2: bucket,
    PAGES_READ_MODEL_DISPATCH_TOKEN: 'test-token',
  }, {
    scheduledAt: NOW,
    now: () => NOW,
    fetcher: async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.status, 'cooldown');
  assert.equal(fetches, 0);
  assert.equal(bucket.puts.length, 0);
});

test('non-watchdog minute does not touch R2', async () => {
  const bucket = r2Bucket();
  const result = await runPagesRealtimeReadModelWatchdog({ PAGES_RESPONSE_R2: bucket }, {
    scheduledAt: NOW + 60_000,
    now: () => NOW + 60_000,
  });
  assert.equal(result.status, 'not-due');
  assert.equal(bucket.heads.length, 0);
});
