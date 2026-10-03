import { describe, expect, it, vi } from 'vitest';

import worker, {
  HOURLY_CRON,
  runHourlyDispatch,
} from '../src/scheduler_dispatch_worker.js';

function namespace(binding, calls, status = 202) {
  return {
    getByName(objectName) {
      return {
        async fetch(url, init) {
          calls.push({ binding, objectName, url, method: init?.method });
          return new Response(null, { status });
        },
      };
    },
  };
}

describe('HomePanel scheduler dispatcher', () => {
  it('fans the hourly tick out to the three existing Durable Object jobs', async () => {
    const calls = [];
    await runHourlyDispatch({
      SCHEDULER_COORDINATOR: namespace('SCHEDULER_COORDINATOR', calls),
      VIDEO_FEED_COORDINATOR: namespace('VIDEO_FEED_COORDINATOR', calls),
    });

    expect(calls).toEqual([
      {
        binding: 'SCHEDULER_COORDINATOR',
        objectName: 'global',
        url: 'https://scheduler.internal/ensure',
        method: 'POST',
      },
      {
        binding: 'VIDEO_FEED_COORDINATOR',
        objectName: 'video-liveness',
        url: 'https://homepanel.internal/video-liveness-run',
        method: 'POST',
      },
      {
        binding: 'VIDEO_FEED_COORDINATOR',
        objectName: 'tver-feed-refresh',
        url: 'https://homepanel.internal/tver-feed-refresh-run',
        method: 'POST',
      },
    ]);
  });

  it('only schedules work for the single configured hourly cron', async () => {
    const waitUntil = vi.fn();
    const env = {
      SCHEDULER_COORDINATOR: namespace('SCHEDULER_COORDINATOR', []),
      VIDEO_FEED_COORDINATOR: namespace('VIDEO_FEED_COORDINATOR', []),
    };

    worker.scheduled({ cron: '5 * * * *' }, env, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();

    worker.scheduled({ cron: HOURLY_CRON }, env, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
  });

  it('fails closed when a Durable Object dispatch is unavailable', async () => {
    await expect(runHourlyDispatch({
      SCHEDULER_COORDINATOR: namespace('SCHEDULER_COORDINATOR', []),
      VIDEO_FEED_COORDINATOR: namespace('VIDEO_FEED_COORDINATOR', [], 503),
    })).rejects.toThrow(/dispatcher returned HTTP 503/);
  });
});
