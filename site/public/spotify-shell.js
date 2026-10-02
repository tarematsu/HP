import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const artistTabs = dashboardModeTabs([
  { value: 'sakurazaka46', label: '櫻坂', active: true },
  { value: 'nogizaka46', label: '乃木坂' },
  { value: 'hinatazaka46', label: '日向坂' },
], {
  dataAttribute: 'spotify-artist',
  className: 'regional-chart-filter',
  ariaLabel: 'Spotify 再生数一覧 表示グループ',
});

const tracksTable = dashboardTable({
  className: 'spotify-table regional-music-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup>',
  headers: ['順位', '曲名', '累計再生数', '前日比'],
  bodyId: 'spotifyTbody',
});

function chartSection({ id, title, titleId, chartId, ariaLabel }) {
  return `
    <section id="${id}" class="music-service-section regional-chart-section spotify-trend-panel">
      <div class="regional-chart-section-head"><h2 id="${titleId}">${title}</h2></div>
      <div id="${chartId}" class="spotify-trend-charts" aria-label="${ariaLabel}"></div>
    </section>`;
}

const trendPanels = `
  ${chartSection({
    id: 'spotifyOverviewTrendSection',
    title: 'Spotify 全曲合計再生数前日比・月間リスナー推移（坂道3グループ）',
    titleId: 'spotifyTrendTitle',
    chartId: 'spotifyTrendCharts',
    ariaLabel: '再生数前日比と月間リスナー',
  })}
  ${chartSection({
    id: 'spotifyTop10YearTrendSection',
    title: 'Spotify 今年リリース上位10曲合計の再生数前日比推移（坂道3グループ）',
    titleId: 'spotifyTop10YearTrendTitle',
    chartId: 'spotifyTop10YearTrendCharts',
    ariaLabel: '今年リリース曲前日比',
  })}
  ${chartSection({
    id: 'spotifyArtistRankTrendSection',
    title: 'Spotify Daily Top Artist（日本）の順位推移（坂道3グループ）',
    titleId: 'spotifyArtistRankTrendTitle',
    chartId: 'spotifyArtistRankTrendCharts',
    ariaLabel: '日本アーティスト順位',
  })}`;

const tracksPanel = `
  <section id="spotifyTrackSection" class="music-service-section regional-chart-section spotify-data-panel">
    <div class="regional-chart-section-head">
      <h2 id="spotifyTableTitle">櫻坂46の再生数一覧</h2>
      ${artistTabs}
    </div>
    ${tracksTable}
  </section>`;

mountDashboardShell({
  tab: {
    view: 'spotify',
    label: 'Spotify',
    anchorSelector: '[data-view="likes"]',
    position: 'beforebegin',
  },
  view: {
    id: 'spotifyView',
    className: 'spotify-view regional-music-view is-chart-compact music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      <div class="regional-chart-meta spotify-chart-meta">
        <span>更新日 <strong id="spotifySnapshotDate">-</strong></span>
        <span>更新周期 <strong>毎日</strong></span>
      </div>
      ${dashboardNotice({ id: 'spotifyNotice' })}
      ${trendPanels}
      ${tracksPanel}`,
  },
});
