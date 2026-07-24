import { describe, expect, it, vi } from "vitest";
import {
  collectLivenessResults,
  LIVENESS_FEED_SNAPSHOT_PENDING_KEY,
  refreshLivenessFeedSnapshotWithRetry,
} from "../src/video_liveness";

type StorageFailureOptions = {
  getFailures?: number;
  putFailures?: number;
};

function fakeStorage(
  initialPending = false,
  options: StorageFailureOptions = {},
) {
  const values = new Map<string, unknown>();
  if (initialPending) values.set(LIVENESS_FEED_SNAPSHOT_PENDING_KEY, true);
  const operations: string[] = [];
  let getFailures = options.getFailures ?? 0;
  let putFailures = options.putFailures ?? 0;
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      operations.push(`get:${key}`);
      if (getFailures > 0) {
        getFailures -= 1;
        throw new Error("storage get unavailable");
      }
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      operations.push(`put:${key}`);
      if (putFailures > 0) {
        putFailures -= 1;
        throw new Error("storage put unavailable");
      }
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

  it("publishes immediately when the first marker write is unavailable", async () => {
    const { storage, values, operations } = fakeStorage(false, { putFailures: 1 });
    const refresh = vi.fn(async () => {
      operations.push("refresh");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(refreshLivenessFeedSnapshotWithRetry(storage, true, refresh))
        .resolves.toBe(true);
    } finally {
      error.mockRestore();
    }

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(values.has(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(false);
    expect(operations).toEqual([
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
      "refresh",
    ]);
  });

  it("retries marker persistence after a publish failure", async () => {
    const { storage, values, operations } = fakeStorage(false, { putFailures: 1 });
    const refresh = vi.fn(async () => {
      operations.push("refresh");
      throw new Error("R2 unavailable");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(refreshLivenessFeedSnapshotWithRetry(storage, true, refresh))
        .rejects.toThrow("R2 unavailable");
    } finally {
      error.mockRestore();
    }

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
    expect(operations).toEqual([
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
      "refresh",
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
    ]);
  });

  it("repairs conservatively when the pending marker cannot be read", async () => {
    const { storage, values, operations } = fakeStorage(false, { getFailures: 1 });
    const refresh = vi.fn(async () => {
      operations.push("refresh");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(refreshLivenessFeedSnapshotWithRetry(storage, false, refresh))
        .resolves.toBe(true);
    } finally {
      error.mockRestore();
    }

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

  it("waits for all scheduled liveness work before recording repair", async () => {
    const { storage, operations } = fakeStorage();
    let siblingSettled = false;
    const slowerSibling = new Promise(resolve => {
      setTimeout(() => {
        siblingSettled = true;
        operations.push("sibling-settled");
        resolve({ ok: true });
      }, 10);
    });

    await expect(collectLivenessResults(storage, [
      Promise.reject(new Error("state write failed")),
      slowerSibling,
    ])).rejects.toThrow("state write failed");

    expect(siblingSettled).toBe(true);
    expect(operations).toEqual([
      "sibling-settled",
      `put:${LIVENESS_FEED_SNAPSHOT_PENDING_KEY}`,
    ]);
  });

  it("preserves the liveness error when marker persistence also fails", async () => {
    const { storage } = fakeStorage(false, { putFailures: 1 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(collectLivenessResults(
        storage,
        [Promise.reject(new Error("state write failed"))],
      )).rejects.toThrow("state write failed");
    } finally {
      error.mockRestore();
    }
  });
});
