import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServiceSection,
  musicServiceViewClassName,
} from './music-service-shell.js?v=20261004.1';

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
  headers: ['年月日', 'グループ', '順位', '曲名'],
  bodyId: 'kugouJapanHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const kugouAcgHistoryTable = dashboardTable({
  className: 'regional-music-table regional-music-kugou-history-table music-service-track-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'kugouAcgHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const qqHistoryTable = dashboardTable({
  className: 'regional-music-table regional-music-kugou-history-table regional-music-qq-history-table music-service-track-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'qqJapanHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const qqAnimeHistoryTable = dashboardTable({
  className: 'regional-music-table regional-music-kugou-history-table regional-music-qq-history-table music-service-track-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'qqAnimeHistoryBody',
  wrapClassName: 'regional-music-table-wrap',
});

const qqPopularityTable = dashboardTable({
  className: 'regional-music-table regional-music-qq-popularity-table music-service-track-table',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
  wrapClassName: 'regional-music-table-wrap',
});

function artistFilterButtons(prefix, label) {
  return dashboardModeTabs([
    { value: 'all', label: 'すべて', active: true },
    { value: 'sakurazaka46', label: '櫻坂' },
    { value: 'nogizaka46', label: '乃木坂' },
    { value: 'hinatazaka46', label: '日向坂' },
  ], {
    dataAttribute: `${prefix}-artist-filter`,
    className: 'regional-chart-filter',
    ariaLabel: label,
  });
}

const qqChartSection = musicServiceSection({
  id: 'qqJapanChartSection',
  title: 'QQ音乐 日本榜 グループ別最高順位推移',
  bodyHtml: '<div id="qqJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div><div id="qqJapanRankChart" class="regional-music-rank-chart"></div>',
  hidden: true,
});

const qqHistorySection = musicServiceSection({
  id: 'qqJapanHistorySection',
  title: 'QQ音乐 日本榜 ランクイン履歴',
  trailingHtml: artistFilterButtons('qq', 'QQ音乐 日本榜 表示グループ'),
  bodyHtml: qqHistoryTable,
  hidden: true,
});

const qqAnimeChartSection = musicServiceSection({
  id: 'qqAnimeChartSection',
  title: 'QQ音乐 动漫音乐榜 グループ別最高順位推移',
  bodyHtml: '<div id="qqAnimeRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div><div id="qqAnimeRankChart" class="regional-music-rank-chart"></div>',
  hidden: true,
});

const qqAnimeHistorySection = musicServiceSection({
  id: 'qqAnimeHistorySection',
  title: 'QQ音乐 动漫音乐榜 ランクイン履歴',
  trailingHtml: artistFilterButtons('qq', 'QQ音乐 动漫音乐榜 表示グループ'),
  bodyHtml: qqAnimeHistoryTable,
  hidden: true,
});

const qqPopularitySection = musicServiceSection({
  id: 'qqArtistPopularitySection',
  title: 'QQ音乐 アーティスト別人気曲順位',
  bodyHtml: qqPopularityTable,
  hidden: true,
});

const kugouChartSection = musicServiceSection({
  id: 'kugouJapanChartSection',
  title: '酷狗音乐 日本榜 グループ別最高順位推移',
  bodyHtml: '<div id="kugouJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div><div id="kugouJapanRankChart" class="regional-music-rank-chart"></div>',
  hidden: true,
});

const kugouHistorySection = musicServiceSection({
  id: 'kugouJapanHistorySection',
  title: '酷狗音乐 日本榜 ランクイン履歴',
  trailingHtml: artistFilterButtons('kugou', '酷狗音乐 日本榜 表示グループ'),
  bodyHtml: kugouHistoryTable,
  hidden: true,
});

const kugouAcgChartSection = musicServiceSection({
  id: 'kugouAcgChartSection',
  title: '酷狗音乐 ACG新歌榜 グループ別最高順位推移',
  bodyHtml: '<div id="kugouAcgRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div><div id="kugouAcgRankChart" class="regional-music-rank-chart"></div>',
  hidden: true,
});

const kugouAcgHistorySection = musicServiceSection({
  id: 'kugouAcgHistorySection',
  title: '酷狗音乐 ACG新歌榜 ランクイン履歴',
  trailingHtml: artistFilterButtons('kugou', '酷狗音乐 ACG新歌榜 表示グループ'),
  bodyHtml: kugouAcgHistoryTable,
  hidden: true,
});

mountDashboardShell({
  view: {
    id: 'regionalMusicView',
    className: musicServiceViewClassName(),
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({
        id: 'regionalMusicCompactMeta',
        valueId: 'regionalMusicChartUpdated',
        cadenceId: 'regionalMusicChartCadence',
      })}
      ${dashboardNotice({ id: 'regionalMusicNotice' })}
      <div id="regionalMusicCompactNotice">${dashboardNotice({ id: 'regionalMusicCompactNoticeText' })}</div>
      ${qqChartSection}
      ${qqHistorySection}
      ${qqAnimeChartSection}
      ${qqAnimeHistorySection}
      ${qqPopularitySection}
      ${kugouChartSection}
      ${kugouHistorySection}
      ${kugouAcgChartSection}
      ${kugouAcgHistorySection}
      <div id="regionalMusicGenericTables">
        ${musicServiceSection({ id: 'regionalMusicArtistSection', title: 'アーティスト', bodyHtml: artistTable })}
        ${musicServiceSection({ id: 'regionalMusicTrackSection', title: '楽曲', bodyHtml: trackTable })}
        ${musicServiceSection({ id: 'regionalMusicPlaylistSection', title: 'プレイリスト', bodyHtml: playlistTable })}
      </div>`,
  },
});

void import('./qq-japan-chart-ui.js?v=20261004.1').then(({ initQqJapanHistoryUi }) => initQqJapanHistoryUi());
