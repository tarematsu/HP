import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dispatchTverFeedRefresh,
  TVER_FEED_COORDINATOR_NAME,
  TVER_FEED_REFRESH_PATH,
  VideoFeedCoordinator,
} from '../src/tver_feed_refresh_coordinator.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('TVer feed refresh dispatch', () => {
  it('keeps the hourly Cron handler to one Durable Object dispatch', async () => {
    const calls = [];
    const env = {
      VIDEO_FEED_COORDINATOR: {
        getByName(name) {
          calls.push({ name });
          return {
            async fetch(url, init) {
              calls.push({ url, init });
              return Response.json({ ok: true, episodeCount: 5 });
            },
          };
        },
      },
    };

    await expect(dispatchTverFeedRefresh(env)).resolves.toEqual({ ok: true, episodeCount: 5 });
    expect(calls[0]).toEqual({ name: TVER_FEED_COORDINATOR_NAME });
    expect(calls[1].url).toBe(`https://homepanel.internal${TVER_FEED_REFRESH_PATH}`);
    expect(calls[1].init).toEqual({ method: 'POST' });
  });

  it('fails clearly when the Durable Object binding is unavailable', async () => {
    await expect(dispatchTverFeedRefresh({})).rejects.toThrow(/VIDEO_FEED_COORDINATOR/);
  });

  it('keeps the TVer refresh route POST-only before doing heavy work', async () => {
    const coordinator = new VideoFeedCoordinator({}, {});
    const response = await coordinator.fetch(new Request(
      `https://homepanel.internal${TVER_FEED_REFRESH_PATH}`,
      { method: 'GET' },
    ));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('does not execute Browser feed refresh inside the Cron invocation', () => {
    const unified = read('src/unified_worker.js');
    const coordinator = read('src/tver_feed_refresh_coordinator.js');

    expect(unified).toContain('dispatchTverFeedRefresh(env)');
    expect(unified).not.toMatch(/ctx\.waitUntil\(refreshTverFeed\(/);
    expect(coordinator).toMatch(/class VideoFeedCoordinator extends BaseVideoFeedCoordinator/);
    expect(coordinator).toMatch(/await refreshTverFeed\(this\.env\)/);
  });
});
