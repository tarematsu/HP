import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';
import {
  musicServiceMeta,
  musicServiceSection,
  musicServiceViewClassName,
} from './music-service-shell.js?v=20261004.1';
import { installSpotifyAllTracksFilter } from './spotify-all-tracks.js?v=20261004.1';
import { installSpotifyUpdatedAt } from './spotify-updated-at.js?v=20261004.1';

const artistTabs = dashboardModeTabs([
  { value: 'all', label: 'すべて' },
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], {
  dataAttribute: 'spotify-artist',
  className: 'regional-chart-filter',
  ariaLabel: 'Spotify 再生数一覧 表示グループ',
  role: 'group',
  selection: 'pressed',
});

const tracksTable = dashboardTable({
  className: 'spotify-table regional-music-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup>',
  headers: ['順位', '曲名', '累計再生数', '前日比'],
  bodyId: 'spotifyTbody',
});

const trendPanels = [
  musicServiceSection({
    id: 'spotifyOverviewTrendSection',
    title: 'Spotify 全曲合計再生数前日比推移（坂道3グループ）',
    titleId: 'spotifyTrendTitle',
    className: 'spotify-trend-panel',
    bodyHtml: '<div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="全曲合計再生数前日比"></div>',
  }),
  musicServiceSection({
    id: 'spotifyMonthlyListenerTrendSection',
    title: 'Spotify 月間リスナー推移（坂道3グループ）',
    titleId: 'spotifyMonthlyListenerTrendTitle',
    className: 'spotify-trend-panel',
    bodyHtml: '<div id="spotifyMonthlyListenerTrendCharts" class="spotify-trend-charts" aria-label="月間リスナー"></div>',
  }),
  musicServiceSection({
    id: 'spotifyTop10YearTrendSection',
    title: 'Spotify 今年リリース上位10曲合計の再生数前日比推移（坂道3グループ）',
    titleId: 'spotifyTop10YearTrendTitle',
    className: 'spotify-trend-panel',
    bodyHtml: '<div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲前日比"></div>',
  }),
  musicServiceSection({
    id: 'spotifyArtistRankTrendSection',
    title: 'Spotify Daily Top Artist（日本）の順位推移（坂道3グループ）',
    titleId: 'spotifyArtistRankTrendTitle',
    className: 'spotify-trend-panel',
    bodyHtml: '<div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="日本アーティスト順位"></div>',
  }),
].join('');

const tracksPanel = musicServiceSection({
  id: 'spotifyTrackSection',
  title: '櫻坂46の再生数一覧',
  titleId: 'spotifyTableTitle',
  trailingHtml: artistTabs,
  className: 'spotify-data-panel',
  bodyHtml: tracksTable,
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
    className: musicServiceViewClassName('spotify-view'),
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'spotifyUpdatedAt', cadence: '毎日朝ごろ' })}
      ${dashboardNotice({ id: 'spotifyNotice' })}
      ${trendPanels}
      ${tracksPanel}`,
  },
});

installSpotifyUpdatedAt();
installSpotifyAllTracksFilter();
