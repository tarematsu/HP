import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testMigrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        r2Buckets: ["UPDATE_BUCKET"],
        bindings: {
          TEST_MIGRATIONS: testMigrations,
          HOMEPANEL_INGEST_SECRET: "test-action",
          API_TOKEN: "test-action",
          DEVICE_TOKEN: "test-device",
          HOMEPANEL_DEVICE_TOKENS: JSON.stringify({
            "ci-device": "test-device",
            "homepanel-device": "test-device",
            "device-a": "token-a",
            "device-b": "token-b",
          }),
          HOMEPANEL_PRIMARY_DEVICE_ID: "",
          SWITCHBOT_TOKEN: "test-token",
          SWITCHBOT_SECRET: "test-secret",
          SWITCHBOT_CONTROL_PLUG_IDS: "",
          SWITCHBOT_EXIT_CONFIRM_SECONDS: "60",
        },
      },
    }),
  ],
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
