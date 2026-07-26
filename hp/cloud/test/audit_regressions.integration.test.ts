import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { readUpdateManifestIdentity } from "../src/update_proxy";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  UPDATE_BUCKET: R2Bucket;
};

const auth = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("repository audit regressions", () => {
  it("allows DEVICE_TOKEN for update commands and rejects unknown tokens", async () => {
    const request = (token: string) => SELF.fetch(
      "https://homepanel.test/v1/device/commands",
      {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({
          deviceId: "homepanel-device",
          command: "check_update",
        }),
      },
    );

    expect((await request("test-device")).status).toBe(202);
    expect((await request("not-a-configured-token")).status).toBe(401);
  });

  it("reports an uninitialized data set as stale instead of healthy", async () => {
    const response = await SELF.fetch("https://homepanel.test/v1/meta", {
      headers: auth("test-device"),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "stale",
      dashboardVersion: 0,
      radarVersion: 0,
    });
  });

  it("does not serve an old healthy Stationhead payload after monitor failure", async () => {
    const payload = JSON.stringify({
      configured: true,
      reachable: true,
      healthy: true,
      lastSuccessAt: 1_000_000,
      reason: null,
    });
    await env.DB.prepare(
      `INSERT INTO current_state(
         source,version,payload,observed_at,fetched_at,last_success_at,status,error,content_hash
       ) VALUES('stationhead_health',1,?1,1000000,2000000,1000000,'stale','monitor database failure','old-hash')`,
    ).bind(payload).run();

    const response = await SELF.fetch("https://homepanel.test/v1/stationhead-health", {
      headers: auth("test-device"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      healthy: false,
      monitorStatus: "stale",
      reason: "monitor database failure",
    });
  });

  it("changes release identity when a same-version manifest is repaired", async () => {
    const bucket = (env as TestEnv).UPDATE_BUCKET;
    const manifest = (sha256: string) => JSON.stringify({
      version: "2607101234",
      signed: false,
      files: [
        { name: "HomePanel.exe", sha256, size: 100, requireAuthenticode: false },
        { name: "HomePanelUpdater.exe", sha256: "b".repeat(64), size: 101, requireAuthenticode: false },
        { name: "WebView2Loader.dll", sha256: "c".repeat(64), size: 102, requireAuthenticode: true },
      ],
    });

    await bucket.put(
      "updates/latest/update-manifest.json",
      manifest("a".repeat(64)),
    );
    const first = await readUpdateManifestIdentity(env);

    await bucket.put(
      "updates/latest/update-manifest.json",
      manifest("d".repeat(64)),
    );
    const repaired = await readUpdateManifestIdentity(env);

    expect(repaired.version).toBe(first.version);
    expect(repaired.manifestHash).not.toBe(first.manifestHash);
  });

  it("serves admin defaults matching the native Stationhead layout", async () => {
    const response = await SELF.fetch("https://homepanel.test/admin");
    const page = await response.text();
    expect(page).toContain("https://www.stationhead.com/sakuramankai");
    expect(page).toContain("https://www.stationhead.com/buddy46");
    expect(page).toContain("width:1920,height:1280");
    expect(page).toContain("blockImages:true,blockFonts:true");
    expect(page).toContain("migrate(body.config)");
    expect(page).toContain('delete station.blockImagesAfterPlayback');
    expect(page).toContain('delete station.hideChatAfterPlayback');
    expect(page).not.toContain("hideChatAfterPlayback:true");
  });
});
