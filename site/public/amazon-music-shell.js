import {
  dashboardChartHost,
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
import { installAmazonMusicUpdatedAt } from './music-service-updated-at.js?v=20261004.1';

const tracksTable = dashboardTable({
  className: 'amazon-table regional-music-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',
  headers: ['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'],
  bodyId: 'amazonMusicTbody',
});

const modeButtons = dashboardModeTabs([
  { value: 'all', label: '全楽曲順位', active: true },
  { value: 'titles', label: '表題曲比較' },
  { value: 'sakurazaka', label: '櫻坂46' },
  { value: 'nogizaka', label: '乃木坂46' },
  { value: 'hinatazaka', label: '日向坂46' },
], {
  dataAttribute: 'amazon-mode',
  className: 'amazon-mode-switch regional-chart-filter',
  ariaLabel: 'Amazon Music表示切替',
  role: 'group',
  selection: 'pressed',
});

const rankSection = musicServiceSection({
  id: 'amazonTrendSection',
  title: 'Amazon Music総合順位推移',
  titleId: 'amazonAllRankTitle',
  trailingHtml: modeButtons,
  bodyHtml: '<div id="amazonRankLegend" class="chart-legend" aria-label="楽曲凡例"></div>' + dashboardChartHost({
    id: 'amazonAllRankChart',
    className: 'amazon-rank-chart chart-fit',
    ariaLabel: '坂道3グループ楽曲のAmazon Music総合順位推移',
    role: '',
  }),
});

const tracksSection = musicServiceSection({
  id: 'amazonTrackSection',
  title: '全楽曲順位',
  titleId: 'amazonTracksTitle',
  bodyHtml: tracksTable,
});

const playlistSection = musicServiceSection({
  id: 'amazonPlaylistSection',
  title: 'Amazon Music プレイリスト掲載一覧',
  bodyHtml: '<div id="amazonPlaylistMount"></div>',
});

mountDashboardShell({
  tab: {
    view: 'amazon-music',
    label: 'Amazon Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'afterend',
  },
  view: {
    id: 'amazonMusicView',
    className: musicServiceViewClassName('amazon-music-view'),
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'amazonUpdatedAt', cadence: '毎日6:00' })}
      ${dashboardNotice({ id: 'amazonMusicNotice' })}
      ${rankSection}
      ${tracksSection}
      ${playlistSection}`,
  },
});

installAmazonMusicUpdatedAt();

function playlistModuleUrl() {
  return ['/music-service-playlists.js', 'v=20261003.2'].join('?');
}

void import(playlistModuleUrl())
  .then((module) => module.loadMusicServicePlaylists?.('amazon'))
  .catch((error) => console.warn('Amazon Music playlist view failed to load', error));
