import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';
import { installSpotifyUpdatedAt } from './spotify-updated-at.js?v=20261004.1';

const artistTabs = musicServiceFilterTabs([
  { value: 'all', label: 'すべて', active: true },
  { value: 'sakurazaka46', label: '櫻坂46' },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], {
  dataAttribute: 'spotify-artist',
  ariaLabel: 'Spotify 再生数一覧 表示グループ',
});

const tracksTable = musicServiceTable({
  className: 'spotify-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-number"><col class="col-delta"></colgroup>',
  headers: ['順位', '曲名', '累計再生数', '前日比'],
  bodyId: 'spotifyTbody',
});

const trendPanels = [
  musicServiceSection({ id: 'spotifyOverviewTrendSection', group: 'plays', title: 'Spotify 全曲合計再生数前日比推移（坂道3グループ）', titleId: 'spotifyTrendTitle', className: 'spotify-trend-panel', bodyHtml: '<div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="全曲合計再生数前日比"></div>' }),
  musicServiceSection({ id: 'spotifyTop10YearTrendSection', group: 'year', title: 'Spotify 今年リリース上位10曲合計の再生数前日比推移（坂道3グループ）', titleId: 'spotifyTop10YearTrendTitle', className: 'spotify-trend-panel', bodyHtml: '<div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲前日比"></div>' }),
];

const tracksPanel = musicServiceSection({
  id: 'spotifyTrackSection', group: 'plays',
  title: '櫻坂46の再生数一覧',
  titleId: 'spotifyTableTitle',
  
  className: 'spotify-data-panel',
  bodyHtml: tracksTable,
});

const dataTables = [
  musicServiceSection({ id: 'spotifyYearDataSection', group: 'year', title: '今年リリース曲の日次集計', bodyHtml: musicServiceTable({ headers: ['日付', 'グループ', '上位10曲合計前日比'], bodyId: 'spotifyYearTbody' }) }),
];

mountMusicServiceView({
  viewId: 'spotifyView',
  className: 'spotify-view',
  groupLabels: { plays: '総再生数', year: '今年リリース曲再生数' },
  noticeId: 'spotifyNotice',
  meta: { valueId: 'spotifyUpdatedAt', cadence: '毎日朝ごろ' },
  beforeSectionsHtml: artistTabs,
  sections: [trendPanels, tracksPanel, dataTables],
});

installSpotifyUpdatedAt();
