import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { BASE_LIVENESS_SELECT_SQL } from "../../video/src/liveness-monitor.js";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("video liveness query indexes", () => {
  it("installs bounded status/id and ranking video indexes", async () => {
    const videoIndexes = await env.DB.prepare("PRAGMA index_list('videos')")
      .all<{ name: string }>();
    const rankingIndexes = await env.DB.prepare("PRAGMA index_list('ranking_entries')")
      .all<{ name: string }>();

    expect(videoIndexes.results?.map(row => row.name)).toContain("idx_videos_status_id");
    expect(rankingIndexes.results?.map(row => row.name)).toContain("idx_ranking_video_period");
  });

  it("plans the runtime base cursor through the status/id index", async () => {
    expect(BASE_LIVENESS_SELECT_SQL).toContain("INDEXED BY idx_videos_status_id");
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN ${BASE_LIVENESS_SELECT_SQL}`,
    ).bind(0, 10_000, 5).all<{ detail: string }>();

    const details = (plan.results ?? []).map(row => row.detail).join("\n");
    expect(details).toContain("idx_videos_status_id");
  });
});
