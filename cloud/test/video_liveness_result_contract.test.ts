import { describe, expect, it } from "vitest";
import {
  collectLivenessResults,
  LIVENESS_FEED_SNAPSHOT_PENDING_KEY,
} from "../src/video_liveness";

function markerStorage() {
  const values = new Map<string, unknown>();
  const storage = {
    async put(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  } as unknown as DurableObjectStorage;
  return { storage, values };
}

describe("video liveness result contract", () => {
  it("fails closed when a non-DO monitor reports an unavailable state row", async () => {
    const { storage, values } = markerStorage();

    await expect(collectLivenessResults(storage, [Promise.resolve({
      ok: true,
      skipped: true,
      reason: "state-unavailable",
    })])).rejects.toThrow("video liveness state row unavailable");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
  });

  it("does not mistake a null rejection reason for a successful result", async () => {
    const { storage, values } = markerStorage();

    await expect(collectLivenessResults(storage, [Promise.reject(null)]))
      .rejects.toThrow("video liveness failed");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
  });

  it("prefers a concrete rejection over an earlier swallowed-null result", async () => {
    const { storage } = markerStorage();

    await expect(collectLivenessResults(storage, [
      Promise.resolve(null),
      Promise.reject(new Error("checkpoint unavailable")),
    ])).rejects.toThrow("checkpoint unavailable");
  });
});
