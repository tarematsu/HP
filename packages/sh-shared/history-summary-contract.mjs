export const SUMMARY_TABLES = Object.freeze({
  daily: 'sh_daily_summary',
  weekly: 'sh_weekly_summary',
  monthly: 'sh_monthly_summary',
});

export function previousSummaryPeriodKey(mode, value) {
  const key = String(value || '');
  if (mode === 'monthly') {
    if (!/^\d{4}-\d{2}$/.test(key)) return null;
    const date = new Date(`${key}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCMonth(date.getUTCMonth() - 1);
    return date.toISOString().slice(0, 7);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - (mode === 'weekly' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

export function currentSummaryPeriodStart(mode, now = Date.now()) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  if (mode === 'monthly') {
    date.setUTCDate(1);
  } else if (mode !== 'daily') {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  }
  return date.getTime();
}
