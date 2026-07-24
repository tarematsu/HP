import type { Env } from "./sources";

const RUNTIME_KEY = "video-liveness-runtime-v1";
const D1_CHECKPOINT_MS = 24 * 60 * 60_000;

interface LivenessRuntimeRow {
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
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function d1Result<T>(results: T[] = [], changes = 0): D1Result<T> {
  return {
    success: true,
    results,
    meta: { changes },
  } as unknown as D1Result<T>;
}

function normalizeRow(value: Partial<LivenessRuntimeRow> | null | undefined): LivenessRuntimeRow {
  return {
    phase: value?.phase === "death" ? "death" : "base",
    baseCursorId: number(value?.baseCursorId),
    baseUpperId: number(value?.baseUpperId),
    deathCursorKey: String(value?.deathCursorKey ?? ""),
    deathUpperKey: String(value?.deathUpperKey ?? ""),
    cycle: number(value?.cycle),
    checkedTotal: number(value?.checkedTotal),
    deadTotal: number(value?.deadTotal),
    revivedTotal: number(value?.revivedTotal),
    lastRunAt: value?.lastRunAt ? String(value.lastRunAt) : null,
    lastCheckedCount: number(value?.lastCheckedCount),
    lastDeadCount: number(value?.lastDeadCount),
    lastRevivedCount: number(value?.lastRevivedCount),
    lastUnknownCount: number(value?.lastUnknownCount),
    lastError: value?.lastError ? String(value.lastError) : null,
    lastD1CheckpointAt: number(value?.lastD1CheckpointAt),
  };
}

async function bootstrapRuntime(
  db: D1Database,
  storage: DurableObjectStorage,
  selectSql: string,
): Promise<LivenessRuntimeRow> {
  const stored = await storage.get<LivenessRuntimeRow>(RUNTIME_KEY);
  if (stored) return normalizeRow(stored);
  const row = await db.prepare(selectSql).first<Record<string, unknown>>();
  if (!row) {
    // Migrations create the singleton row. Synthesizing a zero cursor here would
    // hide schema/data loss and let the DO continue without a recoverable D1
    // checkpoint, so surface the corruption to the scheduler instead.
    throw new Error("video liveness state row unavailable");
  }
  const runtime = normalizeRow({
    ...row,
    lastD1CheckpointAt: row.lastRunAt ? Date.parse(String(row.lastRunAt)) : 0,
  });
  await storage.put(RUNTIME_KEY, runtime);
  return runtime;
}

function fakeSelectStatement(
  db: D1Database,
  storage: DurableObjectStorage,
  sql: string,
): D1PreparedStatement {
  const statement = {
    bind() { return statement; },
    async first<T>(): Promise<T | null> {
      return await bootstrapRuntime(db, storage, sql) as T;
    },
    async all<T>(): Promise<D1Result<T>> {
      const row = await bootstrapRuntime(db, storage, sql);
      return d1Result([row as T]);
    },
    async run<T>(): Promise<D1Result<T>> {
      return d1Result([], 0);
    },
    async raw<T>(): Promise<T[]> { return []; },
  };
  return statement as unknown as D1PreparedStatement;
}

async function checkpointRuntime(env: Env, runtime: LivenessRuntimeRow): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE video_liveness_state
        SET phase = ?1,
            base_cursor_id = ?2,
            base_upper_id = ?3,
            death_cursor_key = ?4,
            death_upper_key = ?5,
            cycle = ?6,
            checked_total = ?7,
            dead_total = ?8,
            revived_total = ?9,
            last_run_at = ?10,
            last_checked_count = ?11,
            last_dead_count = ?12,
            last_revived_count = ?13,
            last_unknown_count = ?14,
            last_error = ?15,
            lock_token = NULL,
            lock_until = NULL
      WHERE id = 1`,
  ).bind(
    runtime.phase,
    runtime.baseCursorId,
    runtime.baseUpperId,
    runtime.deathCursorKey,
    runtime.deathUpperKey,
    runtime.cycle,
    runtime.checkedTotal,
    runtime.deadTotal,
    runtime.revivedTotal,
    runtime.lastRunAt,
    runtime.lastCheckedCount,
    runtime.lastDeadCount,
    runtime.lastRevivedCount,
    runtime.lastUnknownCount,
    runtime.lastError,
  ).run();
  if (number(result.meta?.changes) <= 0) {
    throw new Error("video liveness checkpoint state row unavailable");
  }
}

function fakeUpdateStatement(
  env: Env,
  storage: DurableObjectStorage,
): D1PreparedStatement {
  let values: unknown[] = [];
  const statement = {
    bind(...bindings: unknown[]) {
      values = bindings;
      return statement;
    },
    async run<T>(): Promise<D1Result<T>> {
      const current = normalizeRow(await storage.get<LivenessRuntimeRow>(RUNTIME_KEY));
      const completedAt = String(values[9] ?? new Date().toISOString());
      const completedMs = Number.isFinite(Date.parse(completedAt)) ? Date.parse(completedAt) : Date.now();
      const deadCount = number(values[7]);
      const revivedCount = number(values[8]);
      const next = normalizeRow({
        ...current,
        phase: values[0] == null ? current.phase : values[0] === "death" ? "death" : "base",
        baseCursorId: values[1] == null ? current.baseCursorId : number(values[1]),
        baseUpperId: values[2] == null ? current.baseUpperId : number(values[2]),
        deathCursorKey: values[3] == null ? current.deathCursorKey : String(values[3]),
        deathUpperKey: values[4] == null ? current.deathUpperKey : String(values[4]),
        cycle: values[5] == null ? current.cycle : number(values[5]),
        checkedTotal: current.checkedTotal + number(values[6]),
        deadTotal: current.deadTotal + deadCount,
        revivedTotal: current.revivedTotal + revivedCount,
        lastRunAt: completedAt,
        lastCheckedCount: number(values[10]),
        lastDeadCount: number(values[11]),
        lastRevivedCount: number(values[12]),
        lastUnknownCount: number(values[13]),
        lastError: values[14] == null || values[14] === "" ? null : String(values[14]),
      });
      await storage.put(RUNTIME_KEY, next);

      const checkpoint = Boolean(next.lastError)
        || deadCount > 0
        || revivedCount > 0
        || completedMs - current.lastD1CheckpointAt >= D1_CHECKPOINT_MS;
      if (checkpoint) {
        try {
          // D1 is a recoverable checkpoint for the DO-owned runtime. Persist the
          // cumulative values, not only this run's deltas, otherwise every
          // non-checkpointed run disappears from checked_total after eviction.
          await checkpointRuntime(env, next);
          next.lastD1CheckpointAt = completedMs;
          await storage.put(RUNTIME_KEY, next);
        } catch (error) {
          console.error("video-liveness-d1-checkpoint-failed", error instanceof Error ? error.message : String(error));
        }
      }
      return d1Result([], 1);
    },
    async first<T>(): Promise<T | null> { return null; },
    async all<T>(): Promise<D1Result<T>> {
      return d1Result([], 0);
    },
    async raw<T>(): Promise<T[]> { return []; },
  };
  return statement as unknown as D1PreparedStatement;
}

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export function livenessDoDatabase(
  env: Env,
  storage: DurableObjectStorage,
): D1Database {
  const real = env.DB;
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string): D1PreparedStatement => {
          const normalized = normalizedSql(sql);
          if (normalized.includes("from video_liveness_state where id = 1")) {
            return fakeSelectStatement(real, storage, sql);
          }
          if (normalized.startsWith("update video_liveness_state set phase = coalesce")) {
            return fakeUpdateStatement(env, storage);
          }
          return real.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export { RUNTIME_KEY as VIDEO_LIVENESS_RUNTIME_KEY };
