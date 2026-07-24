import { describe, expect, it } from "vitest";
import {
  collectLivenessResults,
  LIVENESS_FEED_SNAPSHOT_PENDING_KEY,
} from "../src/video_liveness";

describe("video liveness result contract", () => {
  it("fails closed when a non-DO monitor reports an unavailable state row", async () => {
    const values = new Map<string, unknown>();
    const storage = {
      async put(key: string, value: unknown): Promise<void> {
        values.set(key, value);
      },
    } as unknown as DurableObjectStorage;

    await expect(collectLivenessResults(storage, [Promise.resolve({
      ok: true,
      skipped: true,
      reason: "state-unavailable",
    })])).rejects.toThrow("video liveness state row unavailable");

    expect(values.get(LIVENESS_FEED_SNAPSHOT_PENDING_KEY)).toBe(true);
  });
});
