import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/unified_worker.js", import.meta.url), "utf8");

describe("Stationhead leaderboard probe public diagnostic route", () => {
  it("is a GET-only public health route before generic API authorization", () => {
    const pathIndex = source.indexOf("STATIONHEAD_LEADERBOARD_PROBE_HEALTH_PATH");
    const authorizationIndex = source.indexOf("pathname.startsWith('/api/') && !videoApiAuthorized");
    expect(pathIndex).toBeGreaterThanOrEqual(0);
    expect(authorizationIndex).toBeGreaterThan(pathIndex);
    expect(source).toContain("stationheadLeaderboardProbeStatusResponse(env)");
    expect(source).toContain("headers: { Allow: 'GET', 'Cache-Control': 'no-store' }");
  });
});
