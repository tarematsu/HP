import {
  dashboardChartHost,
  dashboardLegend,
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
import { installAppleMusicUpdatedAt } from './music-service-updated-at.js?v=20261004.1';

const artistTabs = dashboardModeTabs([
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], {
  dataAttribute: 'apple-artist',
  className: 'regional-chart-filter',
  ariaLabel: 'Apple Musicアーティスト切替',
  role: 'group',
  selection: 'pressed',
});

const regionTable = dashboardTable({
  id: 'appleRegionCompareTable',
  className: 'apple-table apple-region-table regional-music-table music-service-track-table',
  wrapClassName: 'apple-region-table-wrap',
});

const rankSection = musicServiceSection({
  id: 'appleTrendSection',
  title: 'Apple Music 日本の人気曲順位推移',
  titleId: 'appleJapanRankTitle',
  trailingHtml: artistTabs,
  bodyHtml: `${dashboardLegend({
    id: 'appleRankLegend',
    className: 'apple-rank-legend',
    ariaLabel: '日本の現在順位',
  })}${dashboardChartHost({
    id: 'appleRankChart',
    className: 'apple-rank-chart chart-fit',
    ariaLabel: 'Apple Music日本の人気曲順位推移',
    role: '',
  })}`,
});

const tracksSection = musicServiceSection({
  id: 'appleTrackSection',
  title: 'Apple Music 地域別人気順位一覧',
  titleId: 'appleRegionCompareTitle',
  bodyHtml: regionTable,
});

const playlistSection = musicServiceSection({
  id: 'applePlaylistSection',
  title: '櫻坂46 楽曲別プレイリスト掲載一覧',
  titleId: 'applePlaylistTitle',
  bodyHtml: '<div id="applePlaylistMount"></div>',
});

mountDashboardShell({
  tab: {
    view: 'apple-music',
    label: 'Apple Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'beforebegin',
  },
  view: {
    id: 'appleMusicView',
    className: musicServiceViewClassName('apple-music-view'),
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'appleUpdatedAt', cadence: '毎日6:00' })}
      ${dashboardNotice({ id: 'appleMusicNotice' })}
      ${rankSection}
      ${tracksSection}
      ${playlistSection}`,
  },
});

installAppleMusicUpdatedAt();
