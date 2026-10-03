import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloud = JSON.parse(readFileSync(
  new URL('../hp/cloud/wrangler.jsonc', import.meta.url),
  'utf8',
));
const scheduler = JSON.parse(readFileSync(
  new URL('../hp/cloud/wrangler.scheduler.jsonc', import.meta.url),
  'utf8',
));

test('hourly video Cron is isolated from the heavy integrated Worker and fully observable', () => {
  assert.equal(cloud.triggers, undefined);
  assert.deepEqual(scheduler.triggers?.crons, ['0 * * * *']);
  assert.equal(scheduler.main, 'src/scheduler_dispatch_worker.js');
  assert.equal(scheduler.observability?.enabled, true);
  assert.equal(scheduler.observability?.logs?.enabled, true);
  assert.equal(scheduler.observability?.logs?.persist, true);
  assert.equal(scheduler.observability?.logs?.invocation_logs, true);
  assert.deepEqual(
    scheduler.durable_objects?.bindings?.map(({ name, class_name, script_name }) => ({
      name,
      class_name,
      script_name,
    })),
    [
      {
        name: 'SCHEDULER_COORDINATOR',
        class_name: 'SchedulerCoordinator',
        script_name: 'homepanel-cloud',
      },
      {
        name: 'VIDEO_FEED_COORDINATOR',
        class_name: 'VideoFeedCoordinator',
        script_name: 'homepanel-cloud',
      },
    ],
  );
});
