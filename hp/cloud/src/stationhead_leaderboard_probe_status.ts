import type { Env } from "./sources";

const STATUS_KEY = "diagnostics/stationhead-leaderboard/status.json";
const MAX_SPOOL_RECORDS = 20;
const MAX_BATCH_RECORDS = 8;
const NATIVE_STAGES = new Set([
  "bootstrap",
  "constructed",
  "started",
  "tick",
  "capture_begin",
  "environment_ready",
  "controller_ready",
  "webview_ready",
  "navigating",
  "navigation_completed",
  "snapshot_started",
  "snapshot_parsed",
  "spool_stored",
  "completed",
  "failed",
  "stopped",
]);
const NATIVE_ERRORS = new Set([
  "none",
  "capture_timeout",
  "environment_create",
  "controller_start",
  "controller_create",
  "webview_unavailable",
  "navigation_handler",
  "navigation_failed",
  "navigate_start",
  "snapshot_execute",
  "snapshot_start",
  "snapshot_parse",
  "spool_write",
  "other",
]);

export interface NativeLeaderboardProbeStatus {
  spoolRecords: number;
  batchRecords: number;
  diagnosticSchema: number | null;
  collectorStage: string | null;
  lastSuccessStage: string | null;
  collectorStarted: boolean;
  collectorTicked: boolean;
  lastTransitionAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  exchangeAt: number | null;
}

export interface LeaderboardProbeOutcome {
  submitted: boolean;
  accepted: number;
  stored: boolean;
  reported: boolean;
  error: "none" | "invalid" | "unavailable";
}

type StoredStatus = {
  version: 1;
  updated_at: string;
  stage: string;
  native: {
    spool_records: number;
    batch_records: number;
    diagnostic_schema: number | null;
    collector_stage: string | null;
    last_success_stage: string | null;
    collector_started: boolean;
    collector_ticked: boolean;
    last_transition_at: string | null;
    last_failure_at: string | null;
    last_error: string | null;
    exchange_at: string | null;
  };
  cloud: {
    reached: true;
    probe_submitted: boolean;
    accepted: number;
    stored: boolean;
    dispatch_ok: boolean;
    error: LeaderboardProbeOutcome["error"];
  };
  history: {
    last_probe_received_at: string | null;
    last_stored_at: string | null;
    last_reported_at: string | null;
  };
};

function boundedInteger(value: unknown, maximum: number): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : null;
}

function optionalTimestamp(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 8_640_000_000_000_000
    ? number
    : null;
}

function timestampIso(value: number | null): string | null {
  if (value === null) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function optionalEnum(value: unknown, allowed: Set<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

export function normalizeNativeLeaderboardProbeStatus(
  value: unknown,
): NativeLeaderboardProbeStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const spoolRecords = boundedInteger(input.spoolRecords, MAX_SPOOL_RECORDS);
  const batchRecords = boundedInteger(input.batchRecords, MAX_BATCH_RECORDS);
  if (spoolRecords === null || batchRecords === null || batchRecords > spoolRecords) return null;

  const diagnosticSchema = input.diagnosticSchema === undefined
    ? null
    : boundedInteger(input.diagnosticSchema, 10);
  if (input.diagnosticSchema !== undefined && diagnosticSchema !== 2) return null;

  return {
    spoolRecords,
    batchRecords,
    diagnosticSchema,
    collectorStage: optionalEnum(input.collectorStage, NATIVE_STAGES),
    lastSuccessStage: optionalEnum(input.lastSuccessStage, NATIVE_STAGES),
    collectorStarted: input.collectorStarted === true,
    collectorTicked: input.collectorTicked === true,
    lastTransitionAt: optionalTimestamp(input.lastTransitionAt),
    lastFailureAt: optionalTimestamp(input.lastFailureAt),
    lastError: optionalEnum(input.lastError, NATIVE_ERRORS),
    exchangeAt: optionalTimestamp(input.exchangeAt),
  };
}

async function readPreviousStatus(env: Env): Promise<StoredStatus | null> {
  if (!env.DATA_BUCKET) return null;
  try {
    const object = await env.DATA_BUCKET.get(STATUS_KEY);
    if (!object) return null;
    const parsed = JSON.parse(await object.text());
    return parsed && typeof parsed === "object" && parsed.version === 1
      ? parsed as StoredStatus
      : null;
  } catch {
    return null;
  }
}

function stageFor(
  native: NativeLeaderboardProbeStatus,
  outcome: LeaderboardProbeOutcome,
  previous: StoredStatus | null,
): string {
  if (native.spoolRecords > 0) {
    if (!outcome.submitted) return "native_spooled";
    if (outcome.reported) return "reported_awaiting_ack";
    if (outcome.stored) return "cloud_stored_dispatch_pending";
    if (outcome.error !== "none") return "cloud_error";
    return "cloud_received";
  }
  if (previous?.history.last_reported_at) return "idle_after_report";
  return "waiting_for_probe";
}

export async function applyNativeLeaderboardProbeStatus(
  value: unknown,
  env: Env,
  outcome: LeaderboardProbeOutcome,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.DATA_BUCKET) return { status: 503, body: { error: "diagnostic storage unavailable" } };
  const native = normalizeNativeLeaderboardProbeStatus(value);
  if (!native) return { status: 400, body: { error: "invalid leaderboard probe status" } };

  const previous = await readPreviousStatus(env);
  const now = new Date().toISOString();
  const status: StoredStatus = {
    version: 1,
    updated_at: now,
    stage: stageFor(native, outcome, previous),
    native: {
      spool_records: native.spoolRecords,
      batch_records: native.batchRecords,
      diagnostic_schema: native.diagnosticSchema,
      collector_stage: native.collectorStage,
      last_success_stage: native.lastSuccessStage,
      collector_started: native.collectorStarted,
      collector_ticked: native.collectorTicked,
      last_transition_at: timestampIso(native.lastTransitionAt),
      last_failure_at: timestampIso(native.lastFailureAt),
      last_error: native.lastError,
      exchange_at: timestampIso(native.exchangeAt),
    },
    cloud: {
      reached: true,
      probe_submitted: outcome.submitted,
      accepted: outcome.accepted,
      stored: outcome.stored,
      dispatch_ok: outcome.reported,
      error: outcome.error,
    },
    history: {
      last_probe_received_at: outcome.submitted
        ? now
        : previous?.history.last_probe_received_at ?? null,
      last_stored_at: outcome.stored
        ? now
        : previous?.history.last_stored_at ?? null,
      last_reported_at: outcome.reported
        ? now
        : previous?.history.last_reported_at ?? null,
    },
  };

  await env.DATA_BUCKET.put(STATUS_KEY, JSON.stringify(status), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return { status: 200, body: { stored: true, stage: status.stage } };
}

export async function stationheadLeaderboardProbeStatusResponse(env: Env): Promise<Response> {
  const status = await readPreviousStatus(env);
  return Response.json(status ?? {
    version: 1,
    updated_at: null,
    stage: "no_status",
    native: {
      spool_records: null,
      batch_records: null,
      diagnostic_schema: null,
      collector_stage: null,
      last_success_stage: null,
      collector_started: false,
      collector_ticked: false,
      last_transition_at: null,
      last_failure_at: null,
      last_error: null,
      exchange_at: null,
    },
    cloud: {
      reached: false,
      probe_submitted: false,
      accepted: 0,
      stored: false,
      dispatch_ok: false,
      error: "none",
    },
    history: {
      last_probe_received_at: null,
      last_stored_at: null,
      last_reported_at: null,
    },
  }, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
