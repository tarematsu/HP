import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServicePlaylistCard,
  musicServiceSection,
} from './music-service-shell.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '対象グループ', value: '3組' }),
  dashboardSummaryItem({ label: 'ランクイン曲数', valueId: 'amazonTrackCount' }),
  dashboardSummaryItem({ label: '掲載プレイリスト', valueId: 'amazonPlaylistCount' }),
], { className: 'music-service-summary amazon-summary-cards', ariaLabel: 'Amazon Music概要' });

const tracksTable = dashboardTable({
  className: 'amazon-table music-service-track-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',
  headers: ['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'],
  bodyId: 'amazonMusicTbody',
});

const modeButtons = `
  <div class="mode-tabs amazon-mode-switch" role="group" aria-label="Amazon Music表示切替">
    <button type="button" class="is-active" data-amazon-mode="all" aria-pressed="true">全楽曲順位</button>
    <button type="button" data-amazon-mode="titles" aria-pressed="false">表題曲比較</button>
    <button type="button" data-amazon-mode="nogizaka" aria-pressed="false">乃木坂46</button>
    <button type="button" data-amazon-mode="sakurazaka" aria-pressed="false">櫻坂46</button>
    <button type="button" data-amazon-mode="hinatazaka" aria-pressed="false">日向坂46</button>
  </div>`;

const rankPanel = dashboardChartCard({
  title: 'Amazon Music総合順位推移',
  titleId: 'amazonAllRankTitle',
  kicker: 'AMAZON MUSIC',
  className: 'amazon-rank-panel music-service-panel',
  chartHtml: dashboardChartHost({
    id: 'amazonAllRankChart',
    className: 'amazon-rank-chart chart-fit',
    ariaLabel: '坂道3グループ楽曲のAmazon Music総合順位推移',
    role: '',
  }),
});

const tracksPanel = dashboardDataCard({
  title: '全楽曲順位',
  titleId: 'amazonTracksTitle',
  kicker: 'TRACKS',
  trailingHtml: modeButtons,
  className: 'amazon-data-panel music-service-panel',
  bodyHtml: tracksTable,
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
    className: 'amazon-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'amazonSnapshotDate' })}
      ${dashboardNotice({ id: 'amazonMusicNotice' })}
      ${summary}
      ${musicServiceSection({ id: 'amazonTrendSection', kicker: 'TRENDS', title: '推移', bodyHtml: rankPanel })}
      ${musicServiceSection({ id: 'amazonTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: tracksPanel })}
      ${musicServiceSection({
        id: 'amazonPlaylistSection',
        kicker: 'PLAYLISTS',
        title: 'プレイリスト',
        bodyHtml: musicServicePlaylistCard({
          tableId: 'amazonPlaylistTable',
          titleId: 'amazonPlaylistTitle',
          note: 'Amazon Musicの曲詳細から検出した関連プレイリストを表示します。',
          className: 'amazon-data-panel',
        }),
      })}`,
  },
});

function playlistModuleUrl() {
  return ['/music-service-playlists.js', 'v=20261001.1'].join('?');
}

void import(playlistModuleUrl())
  .then((module) => module.loadMusicServicePlaylists?.('amazon'))
  .catch((error) => console.warn('Amazon Music playlist view failed to load', error));
