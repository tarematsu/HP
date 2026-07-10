import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/sources";
import {
  fetchSh,
  monitorCurrentIndex,
  playbackFeedUrl,
} from "../src/spotify_source";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Stationhead monitor normalization", () => {
  it("preserves monitor query parameters while replacing the endpoint", () => {
    expect(playbackFeedUrl(
      "https://monitor.example/api/dashboard?station=buddy46&token=abc#old",
    )).toBe(
      "https://monitor.example/api/playback?station=buddy46&token=abc",
    );
  });

  it("uses an explicit current marker when queue_status is absent", () => {
    expect(monitorCurrentIndex({
      queue: [
        { title: "first" },
        { title: "second", is_current: true },
      ],
    })).toBe(1);
  });

  it("treats an active broadcast with a current item as playing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://monitor.example/api/playback?station=buddy46",
      );
      return new Response(JSON.stringify({
        ok: true,
        is_broadcasting: true,
        queue: [{
          title: "Current track",
          artist: "Artist",
          duration_ms: 180_000,
          is_current: true,
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSh({
      STATIONHEAD_MONITOR_URL:
        "https://monitor.example/api/dashboard?station=buddy46",
    } as Env);
    const payload = result.payload as {
      connected: boolean;
      playing: boolean;
      item: { name: string } | null;
    };

    expect(payload.connected).toBe(true);
    expect(payload.playing).toBe(true);
    expect(payload.item?.name).toBe("Current track");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
