const DAY_MS = 86_400_000;

export function utcDate(offsetDays = 0, now = Date.now()) {
  return new Date(Number(now) + Number(offsetDays || 0) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function shiftIsoDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function mondayOf(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function currentUtcWeekRange(now = Date.now()) {
  const to = utcDate(0, now);
  return { from: mondayOf(to), to };
}

export function inclusivePresetStart(to, days) {
  const count = Math.max(1, Math.trunc(Number(days) || 30));
  return shiftIsoDate(to, -(count - 1));
}
