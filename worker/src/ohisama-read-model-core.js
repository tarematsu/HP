import {
  mergeStationheadDailyRows,
  nextStationheadDailySummary,
  normalizeStationheadDaily,
  normalizeStationheadHistory,
  rollStationheadHistory,
  stationheadAggregateReadModelPayload,
} from '../../packages/sh-shared/stationhead-read-models.mjs';

export const OHISAMA_PAGES_MODEL_KEY = 'hinata';
export const OHISAMA_PAGES_CADENCE_SECONDS = 5 * 60;

export function normalizeOhisamaHistory(rows = []) {
  return normalizeStationheadHistory(rows);
}

export function normalizeOhisamaDaily(rows = []) {
  return normalizeStationheadDaily(rows);
}

export function ohisamaReadModelPayload(
  collection,
  historyRows = [],
  dailyRows = [],
  updatedAt = Date.now(),
) {
  return stationheadAggregateReadModelPayload(
    'ohisama',
    collection,
    historyRows,
    dailyRows,
    updatedAt,
  );
}

export function nextOhisamaDailySummary(existing, collection, observedAt) {
  return nextStationheadDailySummary(existing, collection, observedAt);
}

export function rollOhisamaHistory(existingRows = [], collection, observedAt) {
  return rollStationheadHistory(existingRows, collection, observedAt);
}

export function mergeOhisamaDailyRows(existingRows = [], currentRow) {
  return mergeStationheadDailyRows(existingRows, currentRow);
}
