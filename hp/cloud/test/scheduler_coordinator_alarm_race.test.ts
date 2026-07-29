import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshRuntimeJobs,
  resetRuntimeFromD1,
  runRuntimeSchedulerTick,
  runtimeNextWakeAt,
} from "../src/scheduler_runtime";
import { SchedulerCoordinator } from "../src/scheduler_coordinator";
import type { Env } from "../src/sources";

vi.mock("../src/scheduler_runtime", () => ({
  refreshRuntimeJobs: vi.fn(),
  resetRuntimeFromD1: vi.fn(),
  runRuntimeSchedulerTick: vi.fn(),
  runtimeNextWakeAt: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function schedulerStorage() {
  let alarmAt: number | null = null;
  const values = new Map<string, unknown>();
  return {
    values,
    storage: {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      getAlarm: vi.fn(async () => alarmAt),
      setAlarm: vi.fn(async (value: number) => {
        alarmAt = value;
      }),
    },
    alarmAt: () => alarmAt,
  };
}

describe("SchedulerCoordinator alarm races", () => {
  beforeEach(() => {
    vi.mocked(refreshRuntimeJobs).mockReset();
    vi.mocked(resetRuntimeFromD1).mockReset();
    vi.mocked(runRuntimeSchedulerTick).mockReset();
    vi.mocked(runtimeNextWakeAt).mockReset();
    vi.mocked(resetRuntimeFromD1).mockResolvedValue();
  });

  it("keeps an earlier wake scheduled while an alarm is still running", async () => {
    const tick = deferred<string[]>();
    vi.mocked(runRuntimeSchedulerTick).mockReturnValue(tick.promise);
    vi.mocked(refreshRuntimeJobs).mockResolvedValue(1);
    vi.mocked(runtimeNextWakeAt).mockImplementation(async (_state, _env, nowMs) =>
      (nowMs ?? Date.now()) + 60_000);

    const { storage, alarmAt } = schedulerStorage();
    const coordinator = new SchedulerCoordinator(
      { storage } as unknown as DurableObjectState,
      {} as Env,
    );

    const runningAlarm = coordinator.alarm();
    await vi.waitFor(() => expect(runRuntimeSchedulerTick).toHaveBeenCalledTimes(1));

    const wake = await coordinator.fetch(new Request("https://scheduler.internal/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["weather"] }),
    }));
    expect(wake.status).toBe(202);
    const earlyAlarm = alarmAt();
    expect(earlyAlarm).not.toBeNull();

    tick.resolve([]);
    await runningAlarm;

    expect(alarmAt()).toBe(earlyAlarm);
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
  });

  it("reloads migrated D1 intervals once before scheduling", async () => {
    vi.mocked(refreshRuntimeJobs).mockResolvedValue(0);
    vi.mocked(runtimeNextWakeAt).mockImplementation(async (_state, _env, nowMs) =>
      (nowMs ?? Date.now()) + 60_000);

    const { storage, values } = schedulerStorage();
    const coordinator = new SchedulerCoordinator(
      { storage } as unknown as DurableObjectState,
      {} as Env,
    );

    const first = await coordinator.fetch(new Request("https://scheduler.internal/ensure", {
      method: "POST",
    }));
    const second = await coordinator.fetch(new Request("https://scheduler.internal/ensure", {
      method: "POST",
    }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(resetRuntimeFromD1).toHaveBeenCalledTimes(1);
    expect(values.get("scheduler-runtime-config-version")).toBe(1);
  });
});
