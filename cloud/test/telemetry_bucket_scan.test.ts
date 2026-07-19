import { describe, expect, it } from "vitest";
import type { Env } from "../src/sources";
import { pendingTelemetryBucketStatement } from "../src/telemetry_bucket";

describe("pending telemetry bucket SQL", () => {
  it("scans pending environment samples only once", () => {
    let sql = "";
    const DB = {
      prepare(value: string) {
        sql = value;
        return { bind: () => ({}) };
      },
    } as unknown as D1Database;

    pendingTelemetryBucketStatement({ DB } as Env, "ci-device", 300_000);
    expect(sql.match(/FROM environment_samples/g)).toHaveLength(1);
    expect(sql).not.toContain("AS applied_count");
  });
});
