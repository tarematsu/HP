import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardSummary,
  dashboardSummaryItem,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '集計日', valueId: 'spotifySnapshotDate', valueClassName: 'summary-date' }),
  dashboardSummaryItem({ label: '櫻坂46の楽曲数', valueId: 'spotifyTrackCount' }),
  dashboardSummaryItem({ label: '櫻坂46の再生数前日比合計', valueId: 'spotifyTotalDelta' }),
], { className: 'spotify-summary', ariaLabel: '櫻坂46 Spotify再生数概要' });

mountDashboardShell({
  tab: {
    view: 'spotify',
    label: 'Spotify',
    anchorSelector: '[data-view="likes"]',
    position: 'beforebegin',
  },
  view: {
    id: 'spotifyView',
    className: 'spotify-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      <p id="spotifyNotice" class="notice" role="status" hidden></p>
      ${summary}
      ${dashboardChartCard({
        title: 'Spotify 全曲合計の再生数前日比推移（上位10組）',
        titleId: 'spotifyTrendTitle',
        kicker: 'FEMALE IDOLS',
        className: 'spotify-trend-panel',
        chartHtml: '<div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="最新日の全曲合計再生数前日比が大きい女性アイドル上位10組の推移"></div>',
      })}
      ${dashboardChartCard({
        title: 'Spotify 今年リリース上位10曲合計の再生数前日比推移（上位10組）',
        titleId: 'spotifyTop10YearTrendTitle',
        kicker: 'FEMALE IDOLS',
        className: 'spotify-trend-panel',
        chartHtml: '<div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲のうち再生数前日比上位10曲の合計が最新日に大きい女性アイドル上位10組の推移"></div>',
      })}
      ${dashboardChartCard({
        title: 'Spotify Daily Top Artist（日本）の順位推移',
        titleId: 'spotifyArtistRankTrendTitle',
        kicker: 'SPOTIFY CHARTS JAPAN',
        className: 'spotify-trend-panel',
        chartHtml: '<div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="Spotify日本 Daily Top Artist における収集対象アーティストの順位推移"></div>',
      })}
      ${dashboardDataCard({
        title: '櫻坂46の再生数一覧',
        titleId: 'spotifyTableTitle',
        kicker: 'SPOTIFY PLAYCOUNTS',
        className: 'spotify-data-panel',
        bodyHtml: '<div class="table-wrap table-fit-mobile"><table class="spotify-table shared-numeric-table"><colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup><thead><tr><th>順位</th><th>曲名</th><th>累計再生数</th><th>前日比</th></tr></thead><tbody id="spotifyTbody"></tbody></table></div>',
      })}`,
  },
});
