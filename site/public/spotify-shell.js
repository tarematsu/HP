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
import { musicServiceMeta, musicServiceSection } from './music-service-shell.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '櫻坂46の楽曲数', labelId: 'spotifyTrackCountLabel', valueId: 'spotifyTrackCount' }),
  dashboardSummaryItem({ label: '櫻坂46の再生数前日比合計', labelId: 'spotifyTotalDeltaLabel', valueId: 'spotifyTotalDelta' }),
  dashboardSummaryItem({ label: 'プレイリスト掲載', valueId: 'spotifyPlaylistCount' }),
], { className: 'music-service-summary spotify-summary', ariaLabel: 'Spotify概要' });

const artistTabs = dashboardModeTabs([
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], { dataAttribute: 'spotify-artist', ariaLabel: 'アーティスト切替' });

const tracksTable = dashboardTable({
  className: 'spotify-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup>',
  headers: ['順位', '曲名', '累計再生数', '前日比'],
  bodyId: 'spotifyTbody',
});

const trendPanels = `
  ${dashboardChartCard({
    title: 'Spotify 全曲合計の再生数前日比推移（坂道3グループ）',
    titleId: 'spotifyTrendTitle',
    kicker: 'SAKAMICHI',
    className: 'spotify-trend-panel music-service-panel',
    chartHtml: '<div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="乃木坂46・櫻坂46・日向坂46の全曲合計再生数前日比推移"></div>',
  })}
  ${dashboardChartCard({
    title: 'Spotify 月間リスナー推移（坂道3グループ）',
    titleId: 'spotifyMonthlyListenerTrendTitle',
    kicker: 'MONTHLY LISTENERS',
    className: 'spotify-trend-panel music-service-panel',
    chartHtml: '<div id="spotifyMonthlyListenerTrendCharts" class="spotify-trend-charts" aria-label="乃木坂46・櫻坂46・日向坂46のSpotify月間リスナー推移"></div>',
  })}
  ${dashboardChartCard({
    title: 'Spotify 今年リリース上位10曲合計の再生数前日比推移（坂道3グループ）',
    titleId: 'spotifyTop10YearTrendTitle',
    kicker: 'SAKAMICHI',
    className: 'spotify-trend-panel music-service-panel',
    chartHtml: '<div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="乃木坂46・櫻坂46・日向坂46の今年リリース上位10曲合計の再生数前日比推移"></div>',
  })}
  ${dashboardChartCard({
    title: 'Spotify Daily Top Artist（日本）の順位推移（坂道3グループ）',
    titleId: 'spotifyArtistRankTrendTitle',
    kicker: 'SPOTIFY CHARTS JAPAN',
    className: 'spotify-trend-panel music-service-panel',
    chartHtml: '<div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="Spotify日本 Daily Top Artist における乃木坂46・櫻坂46・日向坂46の順位推移"></div>',
  })}`;

const tracksPanel = dashboardDataCard({
  title: '櫻坂46の再生数一覧',
  titleId: 'spotifyTableTitle',
  kicker: 'TRACKS',
  trailingHtml: artistTabs,
  className: 'spotify-data-panel music-service-panel',
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
    className: 'spotify-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ label: '集計日', valueId: 'spotifySnapshotDate' })}
      ${dashboardNotice({ id: 'spotifyNotice' })}
      ${summary}
      ${musicServiceSection({ id: 'spotifyTrendSection', kicker: 'TRENDS', title: '推移', bodyHtml: trendPanels })}
      ${musicServiceSection({ id: 'spotifyTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: tracksPanel })}
      ${musicServiceSection({ id: 'spotifyPlaylistSection', kicker: 'PLAYLISTS', title: 'プレイリスト', bodyHtml: '<div id="spotifyPlaylistMount"></div>' })}`,
  },
});

function playlistModuleUrl() {
  return ['/music-service-playlists.js', 'v=20261001.1'].join('?');
}

void import(playlistModuleUrl())
  .then((module) => module.loadMusicServicePlaylists?.('spotify'))
  .catch((error) => console.warn('Spotify playlist view failed to load', error));
