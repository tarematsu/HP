import { describe, expect, it } from "vitest";
import { migrateManagedSpotifyRotation } from "../src/device_sync";
import type { Env } from "../src/sources";
import { managedSpotifySevenSlotRotation } from "../src/spotify_random_catalog";
import { resolveSpotifyTrackDurations } from "../src/spotify_track_durations";

const FIRST_ID = "6Vy6hCA2CZwZalGqaX6Sew";
const SECOND_ID = "5EjWZuODqEPQ9eq7XCmITh";

describe("Spotify rotation duration resolver", () => {
  it("keeps all 31 unique active music targets addressable by trackId", () => {
    const rotation = managedSpotifySevenSlotRotation();
    const tracks = rotation.flatMap(group => group.tracks);
    const ids = tracks.map(track => track.trackId);
    expect(rotation).toHaveLength(8);
    expect(ids).toHaveLength(96);
    expect(new Set(ids).size).toBe(31);
    expect(ids.every(id => /^[A-Za-z0-9]{22}$/.test(id))).toBe(true);
  });

  it("bootstraps the managed cloud rotation when a device has no Spotify config", () => {
    const config: Record<string, unknown> = {};
    expect(migrateManagedSpotifyRotation(config, new Map())).toBe(true);

    const spotify = config.spotify as {
      managedRotation?: boolean;
      rotation?: unknown[];
    };
    expect(spotify.managedRotation).toBe(true);
    expect(spotify.rotation).toHaveLength(8);
    expect(Object.keys(spotify).sort()).toEqual(["managedRotation", "rotation"]);
  });

  it("resolves exact track durations with the current single-track Web API", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("accounts.spotify.com/api/token")) {
        return Response.json({ access_token: "duration-test-token", expires_in: 3600 });
      }
      if (url.includes(`/v1/tracks/${FIRST_ID}`)) {
        return Response.json({ id: FIRST_ID, duration_ms: 235267 });
      }
      if (url.includes(`/v1/tracks/${SECOND_ID}`)) {
        return Response.json({ id: SECOND_ID, duration_ms: 199123 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const env = {
      SPOTIFY_CLIENT_ID: "duration-test-client",
      SPOTIFY_CLIENT_SECRET: "duration-test-secret",
    } as Env;

    const resolved = await resolveSpotifyTrackDurations(
      env,
      [FIRST_ID, SECOND_ID],
      { fetchImpl, now: Date.UTC(2026, 8, 13), concurrency: 1 },
    );

    expect(resolved.get(FIRST_ID)).toBe(235267);
    expect(resolved.get(SECOND_ID)).toBe(199123);
    expect(calls.filter(url => url.includes("accounts.spotify.com/api/token"))).toHaveLength(1);
    expect(calls.some(url => url.includes(`/v1/tracks/${FIRST_ID}`))).toBe(true);
    expect(calls.some(url => url.includes(`/v1/tracks/${SECOND_ID}`))).toBe(true);
  });

  it("does not make track requests without configured client credentials", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const resolved = await resolveSpotifyTrackDurations(
      {} as Env,
      ["33liCluqUasE65nMv3KLLm"],
      { fetchImpl, now: Date.UTC(2026, 8, 13) },
    );

    expect(resolved.size).toBe(0);
    expect(calls).toBe(0);
  });
});
