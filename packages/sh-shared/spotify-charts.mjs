// Japan Charts series. The source decides availability; 404 is never treated as an empty chart.
export const SPOTIFY_JP_CHARTS = Object.freeze([
  ['artist', 'daily'], ['artist', 'weekly'],
  ['regional', 'daily'], ['regional', 'weekly'],
  ['album', 'weekly'],
].map(([type, period]) => Object.freeze({ id: `${type}-jp-${period}`, type, period,
  limit: 200,
  start: '2017-01-01',
})));
export function spotifyChartModelKey(chart = '', year = '') {
  if (!chart && !year) return 'spotify-charts';
  if (!SPOTIFY_JP_CHARTS.some(item => item.id === chart)) return null;
  if (!/^(20[1-9]\d)$/.test(String(year)) || Number(year) < 2017) return null;
  return `spotify-charts:${chart}:${year}`;
}
export const SPOTIFY_CHART_MODEL_KEYS = Object.freeze(['spotify-charts',
  ...SPOTIFY_JP_CHARTS.flatMap(chart => Array.from({ length: 83 }, (_, i) => spotifyChartModelKey(chart.id, String(2017 + i)))),
]);
