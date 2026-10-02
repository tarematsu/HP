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

const qqPopularityTable = dashboardTable({
  className: 'regional-music-table regional-music-qq-popularity-table music-service-track-table',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
  wrapClassName: 'regional-music-table-wrap',
});

const healthPanel = dashboardDataCard({
  title: '収集状態',
  kicker: 'COLLECTOR',
  className: 'regional-music-health music-service-panel',
  bodyHtml: '<dl id="regionalMusicHealth" class="regional-music-health-list"></dl>',
});

function artistFilterButtons(prefix, label) {
  return `
    <div class="mode-tabs regional-chart-filter" role="group" aria-label="${label}">
      <button type="button" class="active" data-${prefix}-artist-filter="all" aria-pressed="true">すべて</button>
      <button type="button" data-${prefix}-artist-filter="sakurazaka46" aria-pressed="false">櫻坂</button>
      <button type="button" data-${prefix}-artist-filter="nogizaka46" aria-pressed="false">乃木坂</button>
      <button type="button" data-${prefix}-artist-filter="hinatazaka46" aria-pressed="false">日向坂</button>
    </div>`;
}

const qqChartSection = `
  <section id="qqJapanChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>QQ Music 日本榜 グループ別最高順位推移</h2></div>
    <div id="qqJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="qqJapanRankChart" class="regional-music-rank-chart"></div>
  </section>`;

const qqHistorySection = `
  <section id="qqJapanHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>QQ Music 日本榜 ランクイン履歴</h2>
      ${artistFilterButtons('qq', 'QQ Music 日本榜 表示グループ')}
    </div>
    ${qqHistoryTable}
  </section>`;

const qqPopularitySection = `
  <section id="qqArtistPopularitySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>QQ Music アーティスト別人気曲順位</h2></div>
    ${qqPopularityTable}
  </section>`;

const kugouChartSection = `
  <section id="kugouJapanChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>Kugou Music 日本榜 グループ別最高順位推移</h2></div>
    <div id="kugouJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="kugouJapanRankChart" class="regional-music-rank-chart"></div>
  </section>`;

const kugouHistorySection = `
  <section id="kugouJapanHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>Kugou Music 日本榜 ランクイン履歴</h2>
      ${artistFilterButtons('kugou', 'Kugou Music 日本榜 表示グループ')}
    </div>
    ${kugouHistoryTable}
  </section>`;

mountDashboardShell({
  view: {
    id: 'regionalMusicView',
    className: 'regional-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      <div id="regionalMusicGenericHeader">
        ${musicServiceMeta({ label: '更新', valueId: 'regionalMusicUpdated' })}
        ${dashboardNotice({ id: 'regionalMusicNotice' })}
        <div class="regional-music-title-row">
          <div><p class="kicker">REGIONAL MUSIC</p><h2 id="regionalMusicTitle">-</h2></div>
          <span id="regionalMusicRegion" class="regional-music-region"></span>
        </div>
        ${summary}
        <section id="regionalMusicHealthSection" class="music-service-section">${healthPanel}</section>
      </div>
      <div id="regionalMusicCompactMeta" class="regional-chart-meta" hidden>
        <span>更新日時 <strong id="regionalMusicChartUpdated">-</strong></span>
        <span>更新周期 <strong id="regionalMusicChartCadence">-</strong></span>
      </div>
      <div id="regionalMusicCompactNotice" hidden>${dashboardNotice({ id: 'regionalMusicCompactNoticeText' })}</div>
      ${qqChartSection}
      ${qqHistorySection}
      ${qqPopularitySection}
      ${kugouChartSection}
      ${kugouHistorySection}
      <div id="regionalMusicGenericTables">
        ${musicServiceSection({ id: 'regionalMusicArtistSection', kicker: 'ARTISTS', title: 'アーティスト', bodyHtml: artistTable })}
        ${musicServiceSection({ id: 'regionalMusicTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: trackTable })}
        ${musicServiceSection({ id: 'regionalMusicPlaylistSection', kicker: 'PLAYLISTS', title: 'プレイリスト', bodyHtml: playlistTable })}
      </div>`,
  },
});

void import('./qq-japan-chart-ui.js?v=20261002.2').then(({ initQqJapanHistoryUi }) => initQqJapanHistoryUi());