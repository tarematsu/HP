import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduled: vi.fn(),
  refreshFeedSnapshot: vi.fn(),
  refreshCompactedFeedSnapshot: vi.fn(),
  readVideoRuntimeActive: vi.fn(),
}));

vi.mock("../../video/src/entry-core.js", () => ({
  default: { scheduled: mocks.scheduled },
}));
vi.mock("../../video/src/feed-snapshot.js", () => ({
  refreshFeedSnapshot: mocks.refreshFeedSnapshot,
}));
vi.mock("../../video/src/source-feed-compacted.js", () => ({
  refreshCompactedFeedSnapshot: mocks.refreshCompactedFeedSnapshot,
}));
vi.mock("../src/video_runtime_activation.js", () => ({
  readVideoRuntimeActive: mocks.readVideoRuntimeActive,
}));

import { runVideoLiveness } from "../src/video_liveness";

describe("direct video liveness snapshot repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readVideoRuntimeActive.mockResolvedValue(true);
    mocks.refreshCompactedFeedSnapshot.mockResolvedValue(undefined);
  });

  it("repairs the compacted snapshot after an uncertain non-DO result", async () => {
    mocks.scheduled.mockImplementation(async (_controller, _env, ctx) => {
      ctx.waitUntil(Promise.resolve(null));
    });

    await expect(runVideoLiveness({ DB: {} } as never))
      .rejects.toThrow("video liveness failed");

    expect(mocks.refreshCompactedFeedSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.refreshFeedSnapshot).not.toHaveBeenCalled();
  });

  it("preserves the liveness error when direct snapshot repair also fails", async () => {
    mocks.scheduled.mockImplementation(async (_controller, _env, ctx) => {
      ctx.waitUntil(Promise.reject(new Error("state write failed")));
    });
    mocks.refreshCompactedFeedSnapshot.mockRejectedValue(new Error("snapshot unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(runVideoLiveness({ DB: {} } as never))
        .rejects.toThrow("state write failed");
    } finally {
      error.mockRestore();
    }

    expect(mocks.refreshCompactedFeedSnapshot).toHaveBeenCalledTimes(1);
  });
});
