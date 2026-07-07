import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

const auth = { Authorization: "Bearer test-device" };

describe("cloud Spotify architecture", () => {
  it("exposes authenticated Spotify status and rejects unknown routes", async () => {
    const unauthorized = await SELF.fetch("https://homepanel.test/v1/spotify/status");
    expect(unauthorized.status).toBe(401);

    const status = await SELF.fetch("https://homepanel.test/v1/spotify/status", { headers: auth });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ connected: false, updatedAt: null });

    for (const path of ["/v1/spotify", "/v1/spotify/connect"]) {
      const response = await SELF.fetch(`https://homepanel.test${path}`, { headers: auth });
      expect(response.status).toBe(404);
    }
  });
});
