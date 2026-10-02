import {
  dashboardDataCard,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServiceSection,
} from './music-service-shell.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '状態', valueId: 'regionalMusicStatus' }),
  dashboardSummaryItem({ label: 'アーティスト', valueId: 'regionalMusicArtistCount' }),
  dashboardSummaryItem({ label: '楽曲', valueId: 'regionalMusicTrackCount' }),
  dashboardSummaryItem({ label: 'プレイリスト', valueId: 'regionalMusicPlaylistCount' }),
], { className: 'music-service-summary regional-music-summary', ariaLabel: '地域音楽サービス概要' });

const artistTable = dashboardTable({
  className: 'regional-music-table regional-music-artist-table music-service-track-table',
  headers: ['アーティスト', 'フォロワー', 'いいね', 'サービスID'],
  bodyId: 'regionalMusicArtistBody',
  wrapClassName: 'regional-music-table-wrap',
});

const trackTable = dashboardTable({
  className: 'regional-music-table regional-music-track-table music-service-track-table',
  headers: ['アーティスト', '曲名', '再生数', 'リスナー', 'いいね', 'コメント', '順位'],
  bodyId: 'regionalMusicTrackBody',
  wrapClassName: 'regional-music-table-wrap',
});

const playlistTable = dashboardTable({
  className: 'regional-music-table regional-music-playlist-table music-service-playlist-table',
  headers: ['プレイリスト', '種別', '所有者', '対象曲数'],
  bodyId: 'regionalMusicPlaylistBody',
  wrapClassName: 'regional-music-table-wrap',
});

const kugouHistoryTable = dashboardTable({
  className: 'regional-music-table regional-music-kugou-history-table music-service-track-table',
  headers: ['日時', 'グループ', '順位', '曲名', '号'],
  bodyId: 'kugouJapanHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const qqHistoryTable = dashboardTable({
  className: 'regional-music-table regional-music-kugou-history-table regional-music-qq-history-table music-service-track-table',
  headers: ['週', 'グループ', '順位', '曲名', '更新日'],
  bodyId: 'qqJapanHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const healthPanel = dashboardDataCard({
  title: '収集状態',
  kicker: 'COLLECTOR',
  className: 'regional-music-health music-service-panel',
  bodyHtml: '<dl id="regionalMusicHealth" class="regional-music-health-list"></dl>',
});

const qqChartSection = `
  <section id="qqJapanChartSection" class="music-service-section" hidden>
    <div class="section-head music-service-section-heading"><div><p class="kicker">JAPAN CHART</p><h2>日本榜 グループ別最高順位推移</h2></div></div>
    <div id="qqJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="qqJapanRankChart" class="regional-music-rank-chart"></div>
    <p id="qqJapanCoverage" class="regional-music-rank-coverage subtle"></p>
  </section>`;

const qqHistorySection = `
  <section id="qqJapanHistorySection" class="music-service-section" hidden>
    <div class="section-head music-service-section-heading"><div><p class="kicker">RANK HISTORY</p><h2>日本榜 ランクイン履歴</h2></div></div>
    ${qqHistoryTable}
  </section>`;

const kugouChartSection = `
  <section id="kugouJapanChartSection" class="music-service-section" hidden>
    <div class="section-head music-service-section-heading"><div><p class="kicker">JAPAN CHART</p><h2>日本榜 グループ別最高順位推移</h2></div></div>
    <div id="kugouJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="kugouJapanRankChart" class="regional-music-rank-chart"></div>
    <p id="kugouJapanCoverage" class="regional-music-rank-coverage subtle"></p>
  </section>`;

const kugouHistorySection = `
  <section id="kugouJapanHistorySection" class="music-service-section" hidden>
    <div class="section-head music-service-section-heading"><div><p class="kicker">RANK HISTORY</p><h2>日本榜 ランクイン履歴</h2></div></div>
    ${kugouHistoryTable}
  </section>`;

mountDashboardShell({
  view: {
    id: 'regionalMusicView',
    className: 'regional-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ label: '更新', valueId: 'regionalMusicUpdated' })}
      ${dashboardNotice({ id: 'regionalMusicNotice' })}
      <div class="regional-music-title-row">
        <div><p class="kicker">REGIONAL MUSIC</p><h2 id="regionalMusicTitle">-</h2></div>
        <span id="regionalMusicRegion" class="regional-music-region"></span>
      </div>
      ${summary}
      <section id="regionalMusicHealthSection" class="music-service-section">${healthPanel}</section>
      ${qqChartSection}
      ${qqHistorySection}
      ${kugouChartSection}
      ${kugouHistorySection}
      ${musicServiceSection({ id: 'regionalMusicArtistSection', kicker: 'ARTISTS', title: 'アーティスト', bodyHtml: artistTable })}
      ${musicServiceSection({ id: 'regionalMusicTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: trackTable })}
      ${musicServiceSection({ id: 'regionalMusicPlaylistSection', kicker: 'PLAYLISTS', title: 'プレイリスト', bodyHtml: playlistTable })}`,
  },
});

void import('./qq-japan-chart-ui.js?v=20261002.1').then(({ initQqJapanHistoryUi }) => initQqJapanHistoryUi());
