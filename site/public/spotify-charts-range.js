// Load only the year shards overlapping the displayed period.
const RANGE_DAYS = Object.freeze({ '1m': 31, '6m': 183, '1y': 366 });
export function spotifyChartYearsForRange(state, range = '1y') {
  const years = (Array.isArray(state?.years) ? state.years : [])
    .filter(year => /^20\d{2}$/.test(String(year)));
  const days = RANGE_DAYS[range];
  if (!days || !/^\d{4}-\d{2}-\d{2}$/.test(String(state?.latest_chart_date || ''))) return years;
  const newest = Date.parse(`${state.latest_chart_date}T00:00:00Z`);
  if (!Number.isFinite(newest)) return years;
  const firstYear = new Date(newest - (days - 1) * 86400000).getUTCFullYear();
  const lastYear = new Date(newest).getUTCFullYear();
  return years.filter(year => Number(year) >= firstYear && Number(year) <= lastYear);
}
