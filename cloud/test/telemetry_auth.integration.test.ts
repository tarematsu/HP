import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("telemetry authorization", () => {
  it("rejects missing bearer credentials before parsing the request body", async () => {
    const response = await SELF.fetch("https://homepanel.test/v1/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
