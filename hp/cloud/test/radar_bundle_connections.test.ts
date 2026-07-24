import { afterEach, describe, expect, it, vi } from "vitest";
import { radarBundleShardResponse } from "../src/radar_bundle";
import type { Env } from "../src/sources";

const baseTime = "20260720012000";

function tilePath(index: number): string {
  return `/v1/radar/tile/jma/${baseTime}/${baseTime}/10/${900 + index}/403.png`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("radar bundle connection limits", () => {
  it("fully drains tile responses with at most four upstream requests active", async () => {
    let active = 0;
    let maximumActive = 0;
    const upstreamFetch = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            controller.close();
            active -= 1;
          }, 5);
        },
      }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await radarBundleShardResponse(new Request(
      "https://scheduler.internal/radar-bundle-shard",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: Array.from({ length: 9 }, (_, index) => tilePath(index)) }),
      },
    ), {} as Env);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(0);
    expect(upstreamFetch).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
  });
});
