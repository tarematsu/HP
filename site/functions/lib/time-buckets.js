export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const JST_OFFSET_MS = 9 * HOUR_MS;

export function minuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / MINUTE_MS) * MINUTE_MS;
}

export function utcDayKey(timestamp) {
  return new Date(Number(timestamp)).toISOString().slice(0, 10);
}

export function jstDayKey(timestamp) {
  return new Date(Number(timestamp) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function utcDayStart(dayKey) {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

export function jstDayStartUtc(dayKey) {
  return utcDayStart(dayKey) - JST_OFFSET_MS;
}

export function previousUtcDay(now = Date.now()) {
  const end = utcDayStart(utcDayKey(now));
  const start = end - DAY_MS;
  return { key: utcDayKey(start), start, end };
}

export function previousJstDay(now = Date.now()) {
  const end = jstDayStartUtc(jstDayKey(now));
  const start = end - DAY_MS;
  return { key: jstDayKey(start), start, end };
}

export function utcWeeklyRange(dayKey) {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const start = date.getTime();
  const startKey = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  const end = date.getTime();
  return { key: startKey, startKey, endKey: date.toISOString().slice(0, 10), start, end };
}

export function utcMonthlyRange(dayKey) {
  const [year, month] = dayKey.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  return {
    key: dayKey.slice(0, 7),
    startKey: startDate.toISOString().slice(0, 10),
    endKey: endDate.toISOString().slice(0, 10),
    start: startDate.getTime(),
    end: endDate.getTime(),
  };
}
