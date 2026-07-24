import { describe, expect, it, vi } from "vitest";
import { memoizedStateHash } from "../src/state_hash_cache";
import type { Env } from "../src/sources";

function envWithDb(db: object): Env {
  return { DB: db as D1Database } as Env;
}

describe("state hash memo", () => {
  it("reuses a digest for the same source and stable JSON", async () => {
    const env = envWithDb({});
    const digest = vi.fn().mockResolvedValue("hash-a");

    await expect(memoizedStateHash(env, "weather", "{\"temperature\":20}", digest))
      .resolves.toBe("hash-a");
    await expect(memoizedStateHash(env, "weather", "{\"temperature\":20}", digest))
      .resolves.toBe("hash-a");

    expect(digest).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the stable JSON changes", async () => {
    const env = envWithDb({});
    const digest = vi.fn()
      .mockResolvedValueOnce("hash-a")
      .mockResolvedValueOnce("hash-b");

    await expect(memoizedStateHash(env, "weather", "{\"temperature\":20}", digest))
      .resolves.toBe("hash-a");
    await expect(memoizedStateHash(env, "weather", "{\"temperature\":21}", digest))
      .resolves.toBe("hash-b");

    expect(digest).toHaveBeenCalledTimes(2);
  });

  it("isolates hashes by D1 binding and source", async () => {
    const first = envWithDb({});
    const second = envWithDb({});
    const digest = vi.fn()
      .mockResolvedValueOnce("weather-first")
      .mockResolvedValueOnce("news-first")
      .mockResolvedValueOnce("weather-second");

    await memoizedStateHash(first, "weather", "{}", digest);
    await memoizedStateHash(first, "news", "{}", digest);
    await memoizedStateHash(second, "weather", "{}", digest);

    expect(digest).toHaveBeenCalledTimes(3);
  });
});
