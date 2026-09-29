const MINUTE_MS = 60_000;

export const MINUTE_FACT_INTERVAL_MINUTES = 5;
export const MINUTE_FACT_INTERVAL_MS = MINUTE_FACT_INTERVAL_MINUTES * MINUTE_MS;

export function minuteFactMinuteAt(observedAt) {
  const timestamp = Number(observedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
}

export function minuteFactDue(observedAt) {
  const minuteAt = minuteFactMinuteAt(observedAt);
  return minuteAt != null && minuteAt % MINUTE_FACT_INTERVAL_MS === 0;
}
