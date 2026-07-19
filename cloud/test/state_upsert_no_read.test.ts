import { describe, expect, it, vi } from "vitest";
import { updateState } from "../src/snapshot";
import type { Env } from "../src/sources";

function fakeEnv() {
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return { env: { DB: { prepare } as unknown as D1Database } as Env, prepare, bind, run };
}

describe("current_state write-through UPSERT", () => {
  it("persists a successful source result without reading the previous row", async () => {
    const { env, prepare, bind, run } = fakeEnv();

    await updateState(env, {
      source: "weather",
      observedAt: 1_800_000_000_000,
      payload: { temperature: 20 },
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(String(prepare.mock.calls[0]?.[0])).toContain("INSERT INTO current_state");
    expect(String(prepare.mock.calls[0]?.[0])).not.toContain("SELECT");
    expect(bind).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("persists an error transition without reading the previous row", async () => {
    const { env, prepare, bind, run } = fakeEnv();

    await updateState(
      env,
      { source: "news", observedAt: 1_800_000_000_000, payload: null },
      "upstream unavailable",
    );

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(String(prepare.mock.calls[0]?.[0])).toContain("ON CONFLICT(source) DO UPDATE");
    expect(String(prepare.mock.calls[0]?.[0])).not.toContain("SELECT");
    expect(bind).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
