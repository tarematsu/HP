import { describe, expect, it } from "vitest";
import {
  stationheadWeeklyCandidateFromRecords,
  stationheadWeeklyCandidateKey,
  stationheadWeeklyRankingDate,
  stationheadWeeklyRowsFromBody,
  stationheadWeeklyWindow,
} from "../src/stationhead_leaderboard_weekly";

const MONDAY = "2026-09-21";
const TUESDAY_CAPTURE = Date.UTC(2026, 8, 22, 10, 30, 0);
const DIGEST = "a".repeat(64);

function leaderboard(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    host: `host${index + 1}`,
  }));
}

describe("Stationhead weekly leaderboard candidate", () => {
  it("normalizes a complete structured leaderboard and assigns the Monday JST date", () => {
    const rows = stationheadWeeklyRowsFromBody(JSON.stringify({
      path: "/leaderboard",
      signed_in: true,
      leaderboard: leaderboard(),
    }));
    expect(rows).toHaveLength(100);
    expect(rows?.[0]).toEqual({ rank: 1, channel_name: "host1" });
    expect(rows?.[99]).toEqual({ rank: 100, channel_name: "host100" });
    expect(stationheadWeeklyRankingDate(TUESDAY_CAPTURE)).toBe(MONDAY);
  });

  it("falls back to rendered text while ignoring previous-rank numbers", () => {
    const lines: string[] = ["Weekly Leaderboard", "Rank"];
    for (let rank = 1; rank <= 100; rank += 1) {
      lines.push(String(rank), `@fallback${rank}`, "I'm ON Stationhead");
      if (rank % 3 === 0) lines.push(String(Math.max(1, rank - 2)));
      else if (rank % 5 === 0) lines.push("new");
    }
    const rows = stationheadWeeklyRowsFromBody(JSON.stringify({
      path: "/leaderboard",
      signed_in: true,
      lines,
    }));
    expect(rows).toHaveLength(100);
    expect(rows?.[29]).toEqual({ rank: 30, channel_name: "fallback30" });
    expect(rows?.[99]).toEqual({ rank: 100, channel_name: "fallback100" });
  });

  it("rejects partial, duplicate, signed-out, and out-of-window snapshots", () => {
    expect(stationheadWeeklyRowsFromBody(JSON.stringify({
      path: "/leaderboard",
      signed_in: true,
      leaderboard: leaderboard(99),
    }))).toBeNull();
    const duplicate = leaderboard();
    duplicate[20] = { rank: 21, host: "host1" };
    expect(stationheadWeeklyRowsFromBody(JSON.stringify({
      path: "/leaderboard",
      signed_in: true,
      leaderboard: duplicate,
    }))).toBeNull();
    expect(stationheadWeeklyRowsFromBody(JSON.stringify({
      path: "/leaderboard",
      signed_in: false,
      leaderboard: leaderboard(),
    }))).toBeNull();

    const sunday = Date.UTC(2026, 8, 20, 12, 0, 0);
    expect(stationheadWeeklyCandidateFromRecords([{
      observed_at: sunday,
      source: "dedicated-webview-dom",
      status: 200,
      body: JSON.stringify({ path: "/leaderboard", signed_in: true, leaderboard: leaderboard() }),
    }], DIGEST)).toBeNull();
  });

  it("builds a sanitized weekly candidate only for Monday-night-through-Tuesday captures", () => {
    const candidate = stationheadWeeklyCandidateFromRecords([{
      observed_at: TUESDAY_CAPTURE,
      source: "dedicated-webview-dom",
      status: 200,
      body: JSON.stringify({
        path: "/leaderboard",
        signed_in: true,
        leaderboard: leaderboard(),
        authorization: "must-not-escape",
      }),
    }], DIGEST);
    expect(candidate).toMatchObject({
      version: 1,
      ranking_date: MONDAY,
      observed_at: TUESDAY_CAPTURE,
      digest: DIGEST,
      row_count: 100,
    });
    expect(JSON.stringify(candidate)).not.toContain("authorization");
    expect(JSON.stringify(candidate)).not.toContain("must-not-escape");
    expect(stationheadWeeklyCandidateKey(MONDAY)).toBe(
      "diagnostics/stationhead-leaderboard/weekly/2026-09-21.json",
    );

    const window = stationheadWeeklyWindow(MONDAY);
    expect(window).toEqual({
      start: Date.UTC(2026, 8, 21, 9, 0, 0),
      end: Date.UTC(2026, 8, 22, 15, 0, 0),
    });
  });
});
