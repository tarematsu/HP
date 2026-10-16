export const SPOTIFY_CHART_ARTIST_ORDER = ['sakurazaka46', 'nogizaka46', 'hinatazaka46', 'sakamichi-selection'];
export function japanChartSeries(periodRows, dates, selectedArtist = 'all', colors = {}, absentRank = 201) {
  const visible = new Set(dates);
  const byId = new Map();
  for (const period of periodRows) {
    if (period.status !== 'ok') continue;
    for (const entry of period.entries || []) {
      if (selectedArtist !== 'all' && !entry.artists.includes(selectedArtist)) continue;
      if (!byId.has(entry.id)) byId.set(entry.id, { id: entry.id, title: entry.title, artistKey: SPOTIFY_CHART_ARTIST_ORDER.find(key => entry.artists.includes(key)), color: colors[SPOTIFY_CHART_ARTIST_ORDER.find(key => entry.artists.includes(key))], ranks: new Map() });
      byId.get(entry.id).ranks.set(period.chart_date, entry.rank);
    }
  }
  const captured = new Set(periodRows.filter(p => p.status === 'ok').map(p => p.chart_date));
  return [...byId.values()].filter(series => [...series.ranks.keys()].some(date => visible.has(date)))
    .sort((a, b) => SPOTIFY_CHART_ARTIST_ORDER.indexOf(a.artistKey) - SPOTIFY_CHART_ARTIST_ORDER.indexOf(b.artistKey) || a.title.localeCompare(b.title, 'ja'))
    .map(({ ranks, ...series }) => ({ ...series, points: dates.map(date => ({ date, rank: ranks.get(date) ?? (captured.has(date) ? absentRank : null) })) }));
}
