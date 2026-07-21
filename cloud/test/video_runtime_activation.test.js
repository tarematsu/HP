import { describe, expect, it, vi } from 'vitest';

import {
  inactiveVideoRuntimeResponse,
  retryInactiveVideoBatch,
  skipInactiveVideoSchedule,
  videoRuntimeActive
} from '../src/video_runtime_activation.js';

function databaseWith(value) {
  const first = vi.fn().mockResolvedValue({ active: value });
  const prepare = vi.fn().mockReturnValue({ first });
  return { database: { prepare }, prepare, first };
}

describe('video runtime activation', () => {
  it('activates only when the migration marker is one', async () => {
    const enabled = databaseWith(1);
    const disabled = databaseWith(0);

    await expect(videoRuntimeActive({ DB: enabled.database }, 1)).resolves.toBe(true);
    await expect(videoRuntimeActive({ DB: disabled.database }, 1)).resolves.toBe(false);
    expect(enabled.prepare).toHaveBeenCalledWith(
      'SELECT active FROM video_runtime_state WHERE id = 1'
    );
  });

  it('fails closed when the activation state cannot be read', async () => {
    const database = {
      prepare() {
        return {
          async first() {
            throw new Error('missing table');
          }
        };
      }
    };

    await expect(videoRuntimeActive({ DB: database }, 1)).resolves.toBe(false);
  });

  it('returns a non-cacheable retry response before migration', async () => {
    const response = inactiveVideoRuntimeResponse();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      retryable: true
    });
  });

  it('retries inactive queue deliveries instead of acknowledging them', () => {
    const retryAll = vi.fn();
    retryInactiveVideoBatch({ messages: [{}], retryAll });
    expect(retryAll).toHaveBeenCalledOnce();
  });

  it('skips inactive scheduled work without throwing', () => {
    expect(() => skipInactiveVideoSchedule({ cron: '*/12 * * * *' })).not.toThrow();
  });
});
