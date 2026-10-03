import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config() {
  return JSON.parse(
    readFileSync(new URL('../wrangler.spotify-playcount.jsonc', import.meta.url), 'utf8'),
  );
}

test('Spotify collector is isolated behind the shared scheduler and owns its event-driven Pages model', () => {
  const value = config();
  assert.equal(value.name, 'sh-spotify-playcount-collector');
  assert.equal(value.main, 'src/spotify-playcount-service-entry.js');
  assert.equal(value.triggers, undefined);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB', 'OTHER_DB']);
  assert.deepEqual(value.r2_buckets, [
    {
      binding: 'PAGES_RESPONSE_R2',
      bucket_name: 'sh-pages-responses',
    },
  ]);
  assert.deepEqual(value.queues.producers, [
    {
      binding: 'SPOTIFY_PLAYCOUNT_QUEUE',
      queue: 'stationhead-spotify-playcount',
    },
  ]);
  assert.equal(value.queues.consumers.length, 1);
  assert.equal(value.queues.consumers[0].queue, 'stationhead-spotify-playcount');
  assert.equal(value.queues.consumers[0].max_batch_size, 5);
  assert.equal(value.queues.consumers[0].max_concurrency, 2);
  assert.equal(value.queues.consumers[0].max_retries <= 4, true);
  assert.deepEqual(value.vars, { SPOTIFY_PLAYCOUNT_ENABLED: true });

  const serviceEntry = readFileSync(new URL('../src/spotify-playcount-service-entry.js', import.meta.url), 'utf8');
  const scheduledQueue = readFileSync(new URL('../src/spotify-scheduled-queue.js', import.meta.url), 'utf8');
  assert.match(scheduledQueue, /SPOTIFY_PLAYCOUNT_CRON = '0 \* \* \* \*'/);
  assert.match(serviceEntry, /enqueueSpotifyScheduledDispatch/);
  assert.doesNotMatch(serviceEntry, /handleInternalScheduled/);
});

test('shared scheduler delegates Spotify work to the Queue CPU budget', async () => {
  const {
    enqueueSpotifyScheduledDispatch,
    processSpotifyScheduledDispatchEntry,
    SPOTIFY_PLAYCOUNT_CRON,
  } = await import('../src/spotify-scheduled-queue.js');
  const queued = [];
  const response = await enqueueSpotifyScheduledDispatch(new Request(
    'https://scheduler.internal/__internal/scheduled',
    {
      method: 'POST',
      body: JSON.stringify({ cron: SPOTIFY_PLAYCOUNT_CRON, scheduled_time: 1234 }),
    },
  ), { SPOTIFY_PLAYCOUNT_QUEUE: { send: async (body) => queued.push(body) } });
  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].message_type, 'spotify-scheduled-dispatch');

  let acknowledged = 0;
  let received;
  const result = await processSpotifyScheduledDispatchEntry({
    body: queued[0],
    ack: () => { acknowledged += 1; },
  }, {}, {
    runSpotifyPlaycountScheduled: async (controller) => { received = controller; },
  });
  assert.deepEqual(received, { cron: SPOTIFY_PLAYCOUNT_CRON, scheduledTime: 1234 });
  assert.equal(acknowledged, 1);
  assert.equal(result.failed, 0);
});

test('failed Spotify Queue scheduling remains retryable', async () => {
  const {
    processSpotifyScheduledDispatchEntry,
    SPOTIFY_PLAYCOUNT_CRON,
    SPOTIFY_SCHEDULED_DISPATCH_TYPE,
  } = await import('../src/spotify-scheduled-queue.js');
  let retried = 0;
  const result = await processSpotifyScheduledDispatchEntry({
    body: {
      message_type: SPOTIFY_SCHEDULED_DISPATCH_TYPE,
      message_version: 1,
      cron: SPOTIFY_PLAYCOUNT_CRON,
      scheduled_time: 1234,
    },
    retry: () => { retried += 1; },
  }, {}, {
    runSpotifyPlaycountScheduled: async () => { throw new Error('temporary'); },
  });
  assert.equal(retried, 1);
  assert.equal(result.failed, 1);
});

test('a stale day is carried forward at the next 05:00 and requests one read-model refresh', () => {
  const entry = readFileSync(new URL('../src/spotify-playcount-entry.js', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../../database/other-migrations/041_spotify_playcount_daily.sql', import.meta.url),
    'utf8',
  );
  assert.match(entry, /jstHour\(scheduledTime\) !== 5/);
  assert.match(entry, /status='stale'/);
  assert.match(entry, /is_carried_forward/);
  assert.match(entry, /status='complete'/);
  assert.match(entry, /if \(carried > 0\)[\s\S]*requestSpotifyReadModelRefresh/);
  assert.match(migration, /is_carried_forward INTEGER NOT NULL DEFAULT 0/);
});

test('catalog discovery is split into one artist per chained queue step before album collection', () => {
  const schedule = readFileSync(new URL('../src/spotify-playcount-schedule.js', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('../src/spotify-playcount-catalog-consumer.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../src/spotify-playcount-queue-router.js', import.meta.url), 'utf8');
  const common = readFileSync(new URL('../src/spotify-playcount-common.js', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../../database/other-migrations/044_spotify_catalog_progress.sql', import.meta.url),
    'utf8',
  );

  assert.match(schedule, /message_type: 'spotify-playcount-catalog'/);
  assert.match(schedule, /catalog_queued: 1/);
  assert.doesNotMatch(schedule, /for \(const artist of collectionArtists\) \{\s*const releases = await discoverArtistReleases/);
  assert.match(catalog, /SELECT run_token,status,catalog_total,catalog_completed/);
  assert.match(catalog, /catalog_completed=catalog_completed\+1/);
  assert.match(catalog, /sendCatalogMessage/);
  assert.match(catalog, /queueActiveReleases/);
  assert.match(router, /spotify-playcount-catalog/);
  assert.match(router, /spotify-playcount-album/);
  assert.match(router, /SPOTIFY_READ_MODEL_REFRESH_TYPE/);
  assert.match(router, /latestCompleteRevision/);
  assert.match(schedule, /confirmationPass/);
  assert.match(schedule, /:confirm/);
  assert.match(schedule, /recovery: 'unconfirmed-complete'/);
  assert.match(router, /confirmed: String\(row\.run_token \|\| ''\)\.endsWith\(':confirm'\)/);
  assert.match(router, /if \(after\?\.confirmed && after\.revision !== before\?\.revision\)[\s\S]*requestSpotifyReadModelRefresh\(env, 'playcount-complete'/);
  assert.doesNotMatch(common, /snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,\s*catalog_total/);
  assert.match(migration, /catalog_total/);
  assert.match(migration, /catalog_completed/);
});
