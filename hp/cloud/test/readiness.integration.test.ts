import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("HomePanel readiness", () => {
  it("requires an action token", async () => {
    const response = await SELF.fetch("https://homepanel.test/v1/ready");
    expect(response.status).toBe(401);
  });

  it("reports the integrated video runtime and healthy production bindings", async () => {
    const response = await SELF.fetch("https://homepanel.test/v1/ready", {
      headers: { Authorization: "Bearer test-action" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "homepanel-cloud",
      checks: {
        d1: { ok: true },
        scheduler: { ok: true },
        deviceSync: { ok: true },
        radarCoordinator: { ok: true },
        dataBucket: { ok: true },
        videoService: { ok: true },
      },
    });
  });
});
