import { describe, expect, it } from "vitest";
import {
  livenessDoDatabase,
  VIDEO_LIVENESS_RUNTIME_KEY,
} from "../src/liveness_do_db";

type RuntimeRow = {
  phase: "base" | "death";
  baseCursorId: number;
  baseUpperId: number;
  deathCursorKey: string;
  deathUpperKey: string;
  cycle: number;
  checkedTotal: number;
  deadTotal: number;
  revivedTotal: number;
  lastRunAt: string | null;
  lastCheckedCount: number;
  lastDeadCount: number;
  lastRevivedCount: number;
  lastUnknownCount: number;
  lastError: string | null;
  lastD1CheckpointAt: number;
};

function runtime(overrides: Partial<RuntimeRow> = {}): RuntimeRow {
  return {
    phase: "base",
    baseCursorId: 20,
    baseUpperId: 100,
    deathCursorKey: "",
    deathUpperKey: "",
    cycle: 4,
    checkedTotal: 100,
    deadTotal: 3,
    revivedTotal: 2,
    lastRunAt: null,
    lastCheckedCount: 0,
    lastDeadCount: 0,
    lastRevivedCount: 0,
    lastUnknownCount: 0,
    lastError: null,
    lastD1CheckpointAt: 0,
    ...overrides,
  };
}

function storageWith(initial?: RuntimeRow) {
  const values = new Map<string, unknown>();
  if (initial) values.set(VIDEO_LIVENESS_RUNTIME_KEY, initial);
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  } as unknown as DurableObjectStorage;
  return { storage, values };
}

function stateUpdate(db: D1Database, completedAt: string) {
  return db.prepare(
    "UPDATE video_liveness_state SET phase = COALESCE(?, phase)",
  ).bind(
    "base",
    25,
    100,
    "",
    "",
    4,
    5,
    0,
    0,
    completedAt,
    5,
    0,
    0,
    0,
    null,
  );
}

describe("liveness DO D1 checkpoints", () => {
  it("writes cumulative counters instead of only the final run delta", async () => {
    const { storage, values } = storageWith(runtime());
    let checkpointSql = "";
    let checkpointBindings: unknown[] = [];
    const realDb = {
      prepare(sql: string) {
        checkpointSql = sql;
        const statement = {
          bind(...bindings: unknown[]) {
            checkpointBindings = bindings;
            return statement;
          },
          async run() {
            return { success: true, results: [], meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const env = { DB: realDb } as unknown as Parameters<typeof livenessDoDatabase>[0];
    const db = livenessDoDatabase(env, storage);
    const completedAt = "2026-07-25T00:00:00.000Z";

    await stateUpdate(db, completedAt).run();

    expect(checkpointSql).toContain("checked_total = ?7");
    expect(checkpointSql).not.toContain("checked_total = COALESCE");
    expect(checkpointBindings[6]).toBe(105);
    expect(checkpointBindings[7]).toBe(3);
    expect(checkpointBindings[8]).toBe(2);
    const stored = values.get(VIDEO_LIVENESS_RUNTIME_KEY) as RuntimeRow;
    expect(stored.checkedTotal).toBe(105);
    expect(stored.lastD1CheckpointAt).toBe(Date.parse(completedAt));
  });

  it("keeps routine runs in DO storage until the checkpoint interval", async () => {
    const completedAt = "2026-07-25T00:00:00.000Z";
    const previousCheckpoint = Date.parse(completedAt) - 60 * 60_000;
    const { storage, values } = storageWith(runtime({
      lastD1CheckpointAt: previousCheckpoint,
    }));
    let prepareCount = 0;
    const realDb = {
      prepare() {
        prepareCount += 1;
        throw new Error("routine run must not touch D1 state");
      },
    } as unknown as D1Database;
    const env = { DB: realDb } as unknown as Parameters<typeof livenessDoDatabase>[0];
    const db = livenessDoDatabase(env, storage);

    await stateUpdate(db, completedAt).run();

    expect(prepareCount).toBe(0);
    const stored = values.get(VIDEO_LIVENESS_RUNTIME_KEY) as RuntimeRow;
    expect(stored.checkedTotal).toBe(105);
    expect(stored.lastD1CheckpointAt).toBe(previousCheckpoint);
  });

  it("fails closed instead of synthesizing a zero runtime when the D1 row is missing", async () => {
    const { storage, values } = storageWith();
    const realDb = {
      prepare() {
        return {
          async first() {
            return null;
          },
        };
      },
    } as unknown as D1Database;
    const env = { DB: realDb } as unknown as Parameters<typeof livenessDoDatabase>[0];
    const db = livenessDoDatabase(env, storage);

    await expect(db.prepare(
      "SELECT phase FROM video_liveness_state WHERE id = 1",
    ).first()).rejects.toThrow("video liveness state row unavailable");

    expect(values.has(VIDEO_LIVENESS_RUNTIME_KEY)).toBe(false);
  });
});
