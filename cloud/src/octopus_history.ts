import { changedOctopusReadings, type ComparableOctopusReading } from "./octopus_reading_filter";
import type { Env } from "./sources";

export interface OctopusReading {
  startAt: string;
  value: string | number;
  supplyPoint: string;
}

export interface OctopusRange {
  from: Date;
  to: Date;
}

export type OctopusRangeFetcher = (range: OctopusRange) => Promise<OctopusReading[]>;

export interface OctopusHistorySyncResult {
  liveReadings: OctopusReading[];
  stableCutoff: number;
  historyFloor: number;
  cursorBefore: number;
  completed: boolean;
}

interface StoredReadingRow {
  supply_point: string;
  observed_at: number;
  energy_kwh: number;
}

interface DailyTotalRow {
  supply_point: string;
  day: string;
  energy_kwh: number;
  slot_count: number;
}

type NormalizedReading = ComparableOctopusReading;

const JST_MS = 9 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 86_400_000;
const SAFE_RANGE_MS = 2 * DAY_MS;
export const OCTOPUS_HISTORY_FLOOR_MS = Date.UTC(2025, 10, 1) - JST_MS;
export const OCTOPUS_COLLECTION_DAYS = 7;
const D1_BATCH_SIZE = 90;
const UPSERT_READING_SQL = `INSERT INTO octopus_readings(account_number,supply_point,observed_at,energy_kwh,updated_at)
 VALUES(?1,?2,?3,?4,?5)
 ON CONFLICT(account_number,supply_point,observed_at) DO UPDATE SET
   energy_kwh=excluded.energy_kwh,
   updated_at=excluded.updated_at
 WHERE octopus_readings.energy_kwh IS NOT excluded.energy_kwh`;

function jstDayKey(timestampMs: number): string {
  return new Date(timestampMs + JST_MS).toISOString().slice(0, 10);
}

function jstDayStart(timestampMs: number): number {
  const local = new Date(timestampMs + JST_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - JST_MS;
}

function dayStartFromKey(day: string): number {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed - JST_MS : Number.NaN;
}

function nextCompleteDayStart(timestampMs: number): number {
  const start = jstDayStart(timestampMs);
  return start < timestampMs ? start + DAY_MS : start;
}

export function octopusStableCutoffJst(nowMs: number): number {
  return Math.floor((nowMs - 2 * DAY_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
}

export function octopusCollectionStart(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new Error("Octopus collection time must be finite");
  const exactStart = nowMs - OCTOPUS_COLLECTION_DAYS * DAY_MS;
  const alignedStart = Math.ceil(exactStart / HALF_HOUR_MS) * HALF_HOUR_MS;
  return Math.max(OCTOPUS_HISTORY_FLOOR_MS, alignedStart);
}

function* safeRanges(fromMs: number, toMs: number): IterableIterator<OctopusRange> {
  for (let cursor = fromMs; cursor < toMs;) {
    const next = Math.min(toMs, cursor + SAFE_RANGE_MS);
    yield { from: new Date(cursor), to: new Date(next) };
    cursor = next;
  }
}

function normalizeReadings(readings: OctopusReading[], stableCutoff: number): NormalizedReading[] {
  const unique = new Map<string, NormalizedReading>();
  for (const reading of readings) {
    const observedAt = Date.parse(reading.startAt);
    const energyKwh = Number(reading.value);
    const supplyPoint = String(reading.supplyPoint ?? "").trim();
    if (!supplyPoint || !Number.isFinite(observedAt) ||
        observedAt < OCTOPUS_HISTORY_FLOOR_MS || observedAt >= stableCutoff) continue;
    if (!Number.isFinite(energyKwh) || energyKwh < 0) continue;
    unique.set(`${supplyPoint}:${observedAt}`, { supplyPoint, observedAt, energyKwh });
  }
  return Array.from(unique.values());
}

async function enforceHistoryFloor(env: Env, accountNumber: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM octopus_readings WHERE account_number=?1 AND observed_at<?2",
  ).bind(accountNumber, OCTOPUS_HISTORY_FLOOR_MS).run();
}

async function readComparableStoredReadings(
  env: Env,
  accountNumber: string,
  normalized: readonly NormalizedReading[],
): Promise<ComparableOctopusReading[]> {
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  for (const reading of normalized) {
    if (reading.observedAt < fromMs) fromMs = reading.observedAt;
    if (reading.observedAt > toMs) toMs = reading.observedAt;
  }
  const result = await env.DB.prepare(
    `SELECT supply_point,observed_at,energy_kwh
       FROM octopus_readings
      WHERE account_number=?1 AND observed_at>=?2 AND observed_at<=?3`,
  ).bind(accountNumber, fromMs, toMs).all<StoredReadingRow>();
  return (result.results ?? []).map(row => ({
    supplyPoint: row.supply_point,
    observedAt: Number(row.observed_at),
    energyKwh: Number(row.energy_kwh),
  }));
}

async function refreshDailyTotals(
  env: Env,
  accountNumber: string,
  changed: readonly NormalizedReading[],
  nowMs: number,
): Promise<void> {
  const days = new Set(changed.map(reading => jstDayKey(reading.observedAt)));
  for (const day of days) {
    const start = dayStartFromKey(day);
    if (!Number.isFinite(start)) continue;
    await env.DB.prepare(
      `INSERT INTO octopus_daily_totals(
         account_number,supply_point,day,energy_kwh,slot_count,updated_at
       )
       SELECT account_number,supply_point,?3,SUM(energy_kwh),COUNT(*),?4
         FROM octopus_readings
        WHERE account_number=?1 AND observed_at>=?2 AND observed_at<?5
        GROUP BY account_number,supply_point
       ON CONFLICT(account_number,supply_point,day) DO UPDATE SET
         energy_kwh=excluded.energy_kwh,
         slot_count=excluded.slot_count,
         updated_at=excluded.updated_at`,
    ).bind(accountNumber, start, day, nowMs, start + DAY_MS).run();
  }
}

async function persistStableReadings(
  env: Env,
  accountNumber: string,
  readings: OctopusReading[],
  stableCutoff: number,
  nowMs: number,
): Promise<void> {
  const normalized = normalizeReadings(readings, stableCutoff);
  if (!normalized.length) return;
  const stored = await readComparableStoredReadings(env, accountNumber, normalized);
  const changed = changedOctopusReadings(normalized, stored);
  if (!changed.length) return;

  const insert = env.DB.prepare(UPSERT_READING_SQL);
  for (let offset = 0; offset < changed.length; offset += D1_BATCH_SIZE) {
    const end = Math.min(changed.length, offset + D1_BATCH_SIZE);
    const statements: D1PreparedStatement[] = [];
    for (let index = offset; index < end; index += 1) {
      const reading = changed[index]!;
      statements.push(insert.bind(
        accountNumber,
        reading.supplyPoint,
        reading.observedAt,
        reading.energyKwh,
        nowMs,
      ));
    }
    await env.DB.batch(statements);
  }
  await refreshDailyTotals(env, accountNumber, changed, nowMs);
}

function addLiveReadings(
  output: Map<string, { reading: OctopusReading; observedAt: number }>,
  readings: readonly OctopusReading[],
  stableCutoff: number,
  nowMs: number,
): void {
  for (const reading of readings) {
    const observedAt = Date.parse(reading.startAt);
    const energyKwh = Number(reading.value);
    const supplyPoint = String(reading.supplyPoint ?? "").trim();
    if (!supplyPoint || !Number.isFinite(observedAt) ||
        observedAt < stableCutoff || observedAt >= nowMs) continue;
    if (!Number.isFinite(energyKwh) || energyKwh < 0) continue;
    output.set(`${supplyPoint}:${observedAt}`, {
      observedAt,
      reading: { startAt: reading.startAt, value: reading.value, supplyPoint },
    });
  }
}

export async function synchronizeOctopusHistory(
  env: Env,
  accountNumber: string,
  nowMs: number,
  _comparisonRangeKey: string,
  _comparisonRange: OctopusRange,
  fetchRange: OctopusRangeFetcher,
): Promise<OctopusHistorySyncResult> {
  if (!Number.isFinite(nowMs)) throw new Error("Octopus synchronization time must be finite");
  const stableCutoff = octopusStableCutoffJst(nowMs);
  const collectionStart = octopusCollectionStart(nowMs);
  const live = new Map<string, { reading: OctopusReading; observedAt: number }>();

  await enforceHistoryFloor(env, accountNumber);
  for (const range of safeRanges(collectionStart, nowMs)) {
    const readings = await fetchRange(range);
    await persistStableReadings(env, accountNumber, readings, stableCutoff, nowMs);
    addLiveReadings(live, readings, stableCutoff, nowMs);
  }

  const liveReadings = Array.from(live.values())
    .sort((left, right) => left.observedAt - right.observedAt ||
      left.reading.supplyPoint.localeCompare(right.reading.supplyPoint))
    .map(item => item.reading);
  return {
    liveReadings,
    stableCutoff,
    historyFloor: OCTOPUS_HISTORY_FLOOR_MS,
    cursorBefore: collectionStart,
    completed: true,
  };
}

async function readRawRange(
  env: Env,
  accountNumber: string,
  fromMs: number,
  toMs: number,
): Promise<OctopusReading[]> {
  if (toMs <= fromMs) return [];
  const result = await env.DB.prepare(
    `SELECT supply_point,observed_at,energy_kwh
       FROM octopus_readings
      WHERE account_number=?1 AND observed_at>=?2 AND observed_at<?3
      ORDER BY observed_at`,
  ).bind(accountNumber, fromMs, toMs).all<StoredReadingRow>();
  return (result.results ?? []).map(row => ({
    supplyPoint: row.supply_point,
    startAt: new Date(Number(row.observed_at)).toISOString(),
    value: Number(row.energy_kwh),
  }));
}

async function readDailyRange(
  env: Env,
  accountNumber: string,
  fromMs: number,
  toMs: number,
): Promise<OctopusReading[]> {
  if (toMs <= fromMs) return [];
  const fromDay = jstDayKey(fromMs);
  const toDay = jstDayKey(toMs);
  const result = await env.DB.prepare(
    `SELECT supply_point,day,energy_kwh,slot_count
       FROM octopus_daily_totals
      WHERE account_number=?1 AND day>=?2 AND day<?3
      ORDER BY day,supply_point`,
  ).bind(accountNumber, fromDay, toDay).all<DailyTotalRow>();
  const rows = result.results ?? [];
  if (!rows.length) return readRawRange(env, accountNumber, fromMs, toMs);

  const readings: OctopusReading[] = [];
  for (const row of rows) {
    const start = dayStartFromKey(row.day);
    const slots = Math.max(0, Math.min(48, Math.trunc(Number(row.slot_count))));
    const total = Number(row.energy_kwh);
    if (!Number.isFinite(start) || !Number.isFinite(total) || total < 0 || slots === 0) continue;
    const value = total / slots;
    for (let slot = 0; slot < slots; slot += 1) {
      const observedAt = start + slot * HALF_HOUR_MS;
      if (observedAt < fromMs || observedAt >= toMs) continue;
      readings.push({
        supplyPoint: row.supply_point,
        startAt: new Date(observedAt).toISOString(),
        value,
      });
    }
  }
  return readings;
}

export async function readStoredOctopusRanges(
  env: Env,
  accountNumber: string,
  ranges: OctopusRange[],
): Promise<OctopusReading[]> {
  const unique = new Map<string, OctopusReading>();
  const stableDailyEnd = jstDayStart(Date.now() - 2 * DAY_MS);
  for (const range of ranges) {
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    const dailyStart = Math.min(toMs, nextCompleteDayStart(fromMs));
    const dailyEnd = Math.max(dailyStart, Math.min(toMs, stableDailyEnd));
    const segments = await Promise.all([
      readRawRange(env, accountNumber, fromMs, dailyStart),
      readDailyRange(env, accountNumber, dailyStart, dailyEnd),
      readRawRange(env, accountNumber, dailyEnd, toMs),
    ]);
    for (const row of segments.flat()) {
      const observedAt = Date.parse(row.startAt);
      unique.set(`${row.supplyPoint}:${observedAt}`, row);
    }
  }
  return Array.from(unique.values());
}
