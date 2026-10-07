import { normalizeStationheadSource } from './stationhead-source.mjs';

export const STATIONHEAD_OPERATIONAL_SCHEMA_VERSION = 1;

function finite(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value, maximum = 800) {
  const parsed = String(value ?? '').trim();
  return parsed ? parsed.slice(0, maximum) : null;
}

function sourceValue(value) {
  return normalizeStationheadSource(value) || text(value, 64) || 'stationhead';
}

export function stationheadOperationalError(error, {
  source = 'stationhead',
  code = null,
  stage = 'unknown',
  at = Date.now(),
  retryable = null,
} = {}) {
  if (!error) return null;
  const object = typeof error === 'object' ? error : { message: error };
  return {
    schema_version: STATIONHEAD_OPERATIONAL_SCHEMA_VERSION,
    source: sourceValue(object.source ?? source),
    code: text(object.code, 120) || text(code, 120) || 'UNKNOWN_ERROR',
    stage: text(object.stage, 120) || text(stage, 120) || 'unknown',
    message: text(object.message ?? object.detail ?? error),
    at: finite(object.at) ?? finite(at),
    retryable: typeof object.retryable === 'boolean'
      ? object.retryable
      : typeof retryable === 'boolean'
        ? retryable
        : null,
  };
}

export function stationheadCheckpoint({
  source = 'stationhead',
  kind = 'collector',
  at = null,
  status = 'unknown',
  cursor = null,
  revision = null,
} = {}) {
  return {
    schema_version: STATIONHEAD_OPERATIONAL_SCHEMA_VERSION,
    source: sourceValue(source),
    kind: text(kind, 120) || 'collector',
    at: finite(at),
    status: text(status, 64) || 'unknown',
    cursor: cursor == null ? null : text(cursor, 500),
    revision: revision == null ? null : text(revision, 500),
  };
}

export function stationheadOperationalHealth({
  source = 'stationhead',
  component = 'collector',
  ok = true,
  observedAt = Date.now(),
  lastRunAt = null,
  lastSuccessAt = null,
  checkpoint = null,
  error = null,
} = {}) {
  const normalizedSource = sourceValue(source);
  const normalizedError = stationheadOperationalError(error, {
    source: normalizedSource,
    at: observedAt,
  });
  const normalizedCheckpoint = checkpoint?.schema_version
    ? checkpoint
    : stationheadCheckpoint({
      source: normalizedSource,
      kind: checkpoint?.kind || component,
      at: checkpoint?.at ?? lastRunAt ?? observedAt,
      status: checkpoint?.status || (normalizedError ? 'error' : ok ? 'ok' : 'degraded'),
      cursor: checkpoint?.cursor,
      revision: checkpoint?.revision,
    });
  return {
    schema_version: STATIONHEAD_OPERATIONAL_SCHEMA_VERSION,
    source: normalizedSource,
    component: text(component, 120) || 'collector',
    status: normalizedError ? (ok ? 'degraded' : 'error') : ok ? 'ok' : 'degraded',
    observed_at: finite(observedAt),
    last_run_at: finite(lastRunAt),
    last_success_at: finite(lastSuccessAt),
    checkpoint: normalizedCheckpoint,
    error: normalizedError,
  };
}
