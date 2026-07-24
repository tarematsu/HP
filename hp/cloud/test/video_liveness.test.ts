import { describe, expect, it } from "vitest";
import { runVideoLiveness } from "../src/video_liveness";

describe("video liveness scheduler bridge", () => {
  it("does not touch video tables while the unified runtime is inactive", async () => {
    const statements: string[] = [];
    const DB = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          async first() {
            return { active: 0 };
          },
        };
      },
    };

    await runVideoLiveness({ DB } as never);

    expect(statements).toEqual([
      "SELECT active FROM video_runtime_state WHERE id = 1",
    ]);
  });

  it("rejects activation read failures so the scheduler applies backoff", async () => {
    const DB = {
      prepare() {
        return {
          async first() {
            throw new Error("temporary D1 failure");
          },
        };
      },
    };

    await expect(runVideoLiveness({ DB } as never)).rejects.toThrow("temporary D1 failure");
  });
});
