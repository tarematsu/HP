import {
  dashboardChartHost,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServiceSection,
  musicServiceViewClassName,
} from './music-service-shell.js?v=20261003.2';
import { installAmazonMusicUpdatedAt } from './music-service-updated-at.js?v=20261003.1';

const tracksTable = dashboardTable({
  className: 'amazon-table regional-music-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',
  headers: ['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'],
  bodyId: 'amazonMusicTbody',
});

const modeButtons = `
  <div class="mode-tabs amazon-mode-switch regional-chart-filter" role="group" aria-label="Amazon Music表示切替">
    <button type="button" class="is-active" data-amazon-mode="all" aria-pressed="true">全楽曲順位</button>
    <button type="button" data-amazon-mode="titles" aria-pressed="false">表題曲比較</button>
    <button type="button" data-amazon-mode="sakurazaka" aria-pressed="false">櫻坂46</button>
    <button type="button" data-amazon-mode="nogizaka" aria-pressed="false">乃木坂46</button>
    <button type="button" data-amazon-mode="hinatazaka" aria-pressed="false">日向坂46</button>
  </div>`;

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
      ${musicServiceMeta({ valueId: 'amazonUpdatedAt', cadence: '毎日朝ごろ' })}
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
