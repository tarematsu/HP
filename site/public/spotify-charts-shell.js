import { mountMusicServiceView, musicServiceFilterTabs, musicServiceSection, musicServiceTable, musicServiceRankChart } from './music-service-shell.js?v=20261004.2';

const labels = { listeners: '月間リスナー', artist: 'トップアーティスト', regional: 'トップソング', album: 'トップアルバム', 'viral-hits': 'Viral Hits Japan' };
const artists = musicServiceFilterTabs([
  { value: 'all', label: 'すべて', active: true },
  { value: 'sakurazaka46', label: '櫻坂' }, { value: 'nogizaka46', label: '乃木坂' },
  { value: 'hinatazaka46', label: '日向坂' }, { value: 'sakamichi-selection', label: '坂道選抜' },
], { dataAttribute: 'spotify-chart-artist', ariaLabel: 'Spotifyチャート 表示グループ' });
const sections = [
  musicServiceSection({ group: 'listeners', title: '月間リスナー推移', bodyHtml: '<div id="spotifyChartsListeners" class="spotify-trend-charts"></div>' }),
  musicServiceSection({ group: 'listeners', title: '月間リスナー一覧', bodyHtml: musicServiceTable({ headers: ['日付', 'グループ', '月間リスナー'], bodyId: 'spotifyChartsListenersBody' }) + '<div id="spotifyChartsListenersPager" class="music-service-pager" aria-label="月間リスナー一覧のページ切替"></div>' }),
];
for (const [type, label] of Object.entries(labels)) {
  if (type === 'listeners') continue;
  const period = musicServiceFilterTabs([
    ...(type === 'album' || type === 'viral-hits' ? [] : [{ value: 'daily', label: '日次', active: true }]),
    ...(type === 'viral-hits' ? [] : [{ value: 'weekly', label: '週次', active: type === 'album' }]),
  ], { dataAttribute: `spotify-chart-period-${type}`, ariaLabel: `${label} 集計期間` });
  sections.push(
    musicServiceSection({ group: type, title: type === 'viral-hits' ? 'Viral Hits Japan（掲載位置）' : `${label}（日本）`, trailingHtml: period,
      bodyHtml: (type === 'viral-hits' ? '<p class="shared-note">Spotify公式プレイリストの掲載順です。旧バイラル50の公式順位ではありません。<a href="https://open.spotify.com/playlist/37i9dQZF1DWZZbpkxU5t9L" target="_blank" rel="noopener noreferrer">Spotifyで確認</a></p>' : '')
        + `<p id="spotifyChartStatus-${type}" class="shared-note"></p>` + musicServiceRankChart({ legendId: `spotifyChartLegend-${type}`, chartId: `spotifyChartPlot-${type}` }) }),
    musicServiceSection({ group: type, title: `${label} 一覧`, bodyHtml: musicServiceTable({
      headers: type === 'regional' ? ['日付', 'グループ', '順位', '曲名', '再生数'] : ['日付', 'グループ', type === 'viral-hits' ? '掲載位置' : '順位', type === 'artist' ? 'アーティスト' : type === 'album' ? 'アルバム' : '曲名'],
      bodyId: `spotifyChartBody-${type}`, className: 'dashboard-responsive-table spotify-chart-history-table',
    }) + `<div id="spotifyChartCards-${type}" class="dashboard-responsive-cards spotify-chart-responsive-cards" aria-label="${label}一覧"></div>`
      + `<div id="spotifyChartPager-${type}" class="music-service-pager" aria-label="${label}一覧のページ切替"></div>` }),
  );
}
mountMusicServiceView({ viewId: 'spotifyChartsView', className: 'spotify-view', noticeId: 'spotifyChartsNotice',
  groupLabels: labels, meta: { valueId: 'spotifyChartsUpdatedAt', cadence: '日次・週次（日本）' }, beforeSectionsHtml: artists, sections });
