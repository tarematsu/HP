import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import { installSpotifyAllTracksFilter } from './spotify-all-tracks.js?v=20261002.1';

const artistTabs = dashboardModeTabs([
  { value: 'all', label: 'すべて' },
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
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

const trendPanels = `
  <section id="spotifyOverviewTrendSection" class="music-service-section regional-chart-section spotify-trend-panel">
    <div class="regional-chart-section-head"><h2 id="spotifyTrendTitle">Spotify 全曲合計再生数前日比・月間リスナー推移（坂道3グループ）</h2></div>
    <div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="再生数前日比と月間リスナー"></div>
  </section>
  <section id="spotifyTop10YearTrendSection" class="music-service-section regional-chart-section spotify-trend-panel">
    <div class="regional-chart-section-head"><h2 id="spotifyTop10YearTrendTitle">Spotify 今年リリース上位10曲合計の再生数前日比推移（坂道3グループ）</h2></div>
    <div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲前日比"></div>
  </section>
  <section id="spotifyArtistRankTrendSection" class="music-service-section regional-chart-section spotify-trend-panel">
    <div class="regional-chart-section-head"><h2 id="spotifyArtistRankTrendTitle">Spotify Daily Top Artist（日本）の順位推移（坂道3グループ）</h2></div>
    <div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="日本アーティスト順位"></div>
  </section>`;

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

installSpotifyAllTracksFilter();
