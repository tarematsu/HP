// Spotify Japan chart rankings and editorial playlist placements are distinct datasets.
export const SPOTIFY_JP_CHARTS = Object.freeze([
  ['artist', 'daily'], ['artist', 'weekly'],
  ['regional', 'daily'], ['regional', 'weekly'],
  ['album', 'weekly'],
].map(([type, period]) => Object.freeze({
  id: `${type}-jp-${period}`, type, period, limit: 200, start: '2017-01-01',
})));

// Spotify editorial playlist IDs are stable even when their display titles change.
// Ordering follows the previously reviewed 16-playlist collection shortlist.
const EDITORIAL_PLAYLISTS = [
  ['spotify-japan-rising', '37i9dQZF1DX9vYRBO9gjDe', 'Spotify Japan 急上昇チャート'],
  ['idol-pop-japan', '37i9dQZF1DX8PLev4Ol7Ml', 'アイドルポップ：ジャパン'],
  ['viral-hits', '37i9dQZF1DWZZbpkxU5t9L', 'Viral Hits Japan'],
  ['tokyo-super-hits', '37i9dQZF1DXafb0IuPwJyF', 'Tokyo Super Hits!'],
  ['j-pop-hits', '37i9dQZF1DXdbRLJPSmnyq', 'J-Pop Hits'],
  ['teen-culture', '37i9dQZF1DX8XStIuaEA9J', 'Teen Culture'],
  ['buzz-tracker', '37i9dQZF1DXdTxsEGukhp4', 'Buzz Tracker #バズトラ'],
  ['hot-hits-japan', '37i9dQZF1DXayDMsJG9ZBv', 'Hot Hits Japan'],
  ['new-music-wednesday', '37i9dQZF1DWYBDycFJuxRt', 'New Music Wednesday'],
  ['new-music-friday-japan', '37i9dQZF1DXc57cuGAMEkA', 'New Music Friday Japan'],
  ['equal-japan', '37i9dQZF1DX2K2376Q0zTJ', 'EQUAL Japan'],
  ['radar-early-noise', '37i9dQZF1DX4OR8pnFkwhR', 'RADAR: Early Noise'],
  ['fresh-finds-japan', '37i9dQZF1DX5IW96hDMVED', 'Fresh Finds Japan'],
  ['kirakira-pop-japan', '37i9dQZF1DWVlypmfyCIGr', 'キラキラポップ：ジャパン'],
  ['j-rock-on', '37i9dQZF1DX6ntWKaOqGAp', 'J-Rock ON!!'],
  ['k-pop-on', '37i9dQZF1DX9tPFwDMOaN1', 'K-Pop ON! (온)'],
];
export const SPOTIFY_EDITORIAL_PLAYLISTS = Object.freeze(EDITORIAL_PLAYLISTS.map(([slug, playlistId, name]) => Object.freeze({
  id: slug === 'viral-hits' ? 'viral-hits-jp-daily' : `playlist-${slug}-daily`,
  slug, playlistId, name, url: `https://open.spotify.com/playlist/${playlistId}`,
  type: 'playlist', period: 'daily', limit: 300,
  source: 'spotify-playlist-position', start: '2026-10-16',
})));
export const SPOTIFY_CHART_SOURCES = Object.freeze([...SPOTIFY_JP_CHARTS, ...SPOTIFY_EDITORIAL_PLAYLISTS]);
export function spotifyChartModelKey(chart = '', year = '') {
  if (!chart && !year) return 'spotify-charts';
  if (!SPOTIFY_CHART_SOURCES.some(item => item.id === chart)) return null;
  if (!/^(20[1-9]\d)$/.test(String(year)) || Number(year) < 2017) return null;
  return `spotify-charts:${chart}:${year}`;
}
export const SPOTIFY_CHART_MODEL_KEYS = Object.freeze(['spotify-charts',
  ...SPOTIFY_CHART_SOURCES.flatMap(chart => Array.from({ length: 83 }, (_, i) => spotifyChartModelKey(chart.id, String(2017 + i)))),
]);
