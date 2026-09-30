import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardModeTabs,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '集計日', valueId: 'spotifySnapshotDate', valueClassName: 'summary-date' }),
  dashboardSummaryItem({ label: '櫻坂46の楽曲数', labelId: 'spotifyTrackCountLabel', valueId: 'spotifyTrackCount' }),
  dashboardSummaryItem({ label: '櫻坂46の再生数前日比合計', labelId: 'spotifyTotalDeltaLabel', valueId: 'spotifyTotalDelta' }),
], { className: 'spotify-summary', ariaLabel: 'Spotify再生数概要' });

const artistTabs = dashboardModeTabs([
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], { dataAttribute: 'spotify-artist', ariaLabel: 'アーティスト切替' });

const tracksTable = dashboardTable({
  className: 'spotify-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup>',
  headers: ['順位', '曲名', '累計再生数', '前日比'],
  bodyId: 'spotifyTbody',
});

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
      ${dashboardNotice({ id: 'spotifyNotice' })}
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
        trailingHtml: artistTabs,
        className: 'spotify-data-panel',
        bodyHtml: tracksTable,
      })}`,
  },
});
