import { describe, expect, it, vi } from "vitest";
import {
  collectLivenessResults,
  LIVENESS_FEED_SNAPSHOT_PENDING_KEY,
  refreshLivenessFeedSnapshotWithRetry,
} from "../src/video_liveness";

function fakeStorage(initialPending = false) {
  const values = new Map<string, unknown>();
  if (initialPending) values.set(LIVENESS_FEED_SNAPSHOT_PENDING_KEY, true);
  const operations: string[] = [];
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      operations.push(`get:${key}`);
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      operations.push(`put:${key}`);
      values.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      operations.push(`delete:${key}`);
      return values.delete(key);
    },
  } as unknown as DurableObjectStorage;
  return { storage, values, operations };
}

describe("liveness feed snapshot retry", () => {
  it("persists the repair obligation before publishing and keeps it after failure", async () => {
    const { storage, values, operations } = fakeStorage();
    const refresh = vi.fn(async () => {
      operations.push("refresh");
      throw new Error("R2 unavailable");
    });

    await expect(refreshLivenessFeedSnapshotWithRetry(storage, true, refresh))
      .rejects.toThrow("R2 unavailable");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
    expect(operations).toEqual([
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
      "refresh",
    ]);
  });

  it("retries a previous failed publish even when the next liveness batch is unchanged", async () => {
    const { storage, values, operations } = fakeStorage(true);
    const refresh = vi.fn(async () => {
      operations.push("refresh");
    });

    await expect(refreshLivenessFeedSnapshotWithRetry(storage, false, refresh))
      .resolves.toBe(true);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(values.has(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(false);
    expect(operations).toEqual([
      `get:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
      "refresh",
      `delete:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
    ]);
  });

  it("does not publish when neither the batch nor durable state requires repair", async () => {
    const { storage, operations } = fakeStorage();
    const refresh = vi.fn(async () => {});

    await expect(refreshLivenessFeedSnapshotWithRetry(storage, false, refresh))
      .resolves.toBe(false);

    expect(refresh).not.toHaveBeenCalled();
    expect(operations).toEqual([`get:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`]);
  });

  it("marks snapshot repair pending when liveness reports a swallowed failure", async () => {
    const { storage, values, operations } = fakeStorage();

    await expect(collectLivenessResults(storage, [Promise.resolve(null)]))
      .rejects.toThrow("video liveness failed");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
    expect(operations).toEqual([`put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`]);
  });

  it("marks snapshot repair pending when liveness rejects after partial work", async () => {
    const { storage, values } = fakeStorage();

    await expect(collectLivenessResults(storage, [Promise.reject(new Error("state write failed"))]))
      .rejects.toThrow("state write failed");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
  });
});
