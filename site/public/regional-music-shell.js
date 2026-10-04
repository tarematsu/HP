import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceNotice,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

const table = (options = {}) => musicServiceTable({
  wrapClassName: 'regional-music-table-wrap',
  ...options,
});

const artistTable = table({
  className: 'regional-music-artist-table',
  headers: ['アーティスト', 'フォロワー', 'いいね', 'サービスID'],
  bodyId: 'regionalMusicArtistBody',
});

const trackTable = table({
  className: 'regional-music-track-table',
  headers: ['アーティスト', '曲名', '再生数', 'リスナー', 'いいね', 'コメント', '順位'],
  bodyId: 'regionalMusicTrackBody',
});

const playlistTable = table({
  kind: 'playlist',
  className: 'regional-music-playlist-table',
  headers: ['プレイリスト', '種別', '所有者', '対象曲数'],
  bodyId: 'regionalMusicPlaylistBody',
});

const kkboxHistoryTable = table({
  className: 'regional-music-kugou-history-table regional-music-kkbox-history-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'kkboxJapaneseHistoryBody',
});

const kugouHistoryTable = table({
  className: 'regional-music-kugou-history-table',
  headers: ['年月日', 'グループ', '順位', '曲名'],
  bodyId: 'kugouJapanHistoryBody',
});

const kugouAcgHistoryTable = table({
  className: 'regional-music-kugou-history-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'kugouAcgHistoryBody',
});

const qqHistoryTable = table({
  className: 'regional-music-kugou-history-table regional-music-qq-history-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'qqJapanHistoryBody',
});

const qqAnimeHistoryTable = table({
  className: 'regional-music-kugou-history-table regional-music-qq-history-table',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'qqAnimeHistoryBody',
});

const qqPopularityTable = table({
  className: 'regional-music-qq-popularity-table',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
});

function artistFilterButtons(prefix, label) {
  return musicServiceFilterTabs([
    { value: 'all', label: 'すべて', active: true },
    { value: 'sakurazaka46', label: '櫻坂' },
    { value: 'nogizaka46', label: '乃木坂' },
    { value: 'hinatazaka46', label: '日向坂' },
  ], {
    dataAttribute: `${prefix}-artist-filter`,
    ariaLabel: label,
  });
}

function kkboxSeriesFilterButtons() {
  return [
    musicServiceFilterTabs([
      { value: 'tw', label: '台湾', active: true },
      { value: 'hk', label: '香港' },
    ], {
      dataAttribute: 'kkbox-territory-filter',
      ariaLabel: 'KKBOX 地域',
    }),
    musicServiceFilterTabs([
      { value: 'weekly', label: '週次', active: true },
      { value: 'daily', label: '日次' },
    ], {
      dataAttribute: 'kkbox-period-filter',
      ariaLabel: 'KKBOX 更新周期',
    }),
    musicServiceFilterTabs([
      { value: 'newrelease', label: '新曲', active: true },
      { value: 'song', label: '楽曲' },
    ], {
      dataAttribute: 'kkbox-chart-filter',
      ariaLabel: 'KKBOX チャート種別',
    }),
  ].join('');
}

const kkboxChartSection = musicServiceSection({
  id: 'kkboxJapaneseChartSection',
  title: 'KKBOX 日語チャート グループ別最高順位推移',
  bodyHtml: `${kkboxSeriesFilterButtons()}<div id="kkboxJapaneseRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div><div id="kkboxJapaneseRankChart" class="regional-music-rank-chart"></div>`,
  hidden: true,
});

const kkboxHistorySection = musicServiceSection({
  id: 'kkboxJapaneseHistorySection',
  title: 'KKBOX 日語チャート ランクイン履歴',
  trailingHtml: artistFilterButtons('kkbox', 'KKBOX 日語チャート 表示グループ'),
  bodyHtml: kkboxHistoryTable,
  hidden: true,
});

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

const genericSections = `<div id="regionalMusicGenericTables">
  ${musicServiceSection({ id: 'regionalMusicArtistSection', title: 'アーティスト', bodyHtml: artistTable })}
  ${musicServiceSection({ id: 'regionalMusicTrackSection', title: '楽曲', bodyHtml: trackTable })}
  ${musicServiceSection({ id: 'regionalMusicPlaylistSection', title: 'プレイリスト', bodyHtml: playlistTable })}
</div>`;

mountMusicServiceView({
  viewId: 'regionalMusicView',
  noticeId: 'regionalMusicNotice',
  meta: {
    id: 'regionalMusicCompactMeta',
    valueId: 'regionalMusicChartUpdated',
    cadenceId: 'regionalMusicChartCadence',
  },
  beforeSectionsHtml: `<div id="regionalMusicCompactNotice">${musicServiceNotice('regionalMusicCompactNoticeText')}</div>`,
  sections: [
    kkboxChartSection,
    kkboxHistorySection,
    qqChartSection,
    qqHistorySection,
    qqAnimeChartSection,
    qqAnimeHistorySection,
    qqPopularitySection,
    kugouChartSection,
    kugouHistorySection,
    kugouAcgChartSection,
    kugouAcgHistorySection,
    genericSections,
  ],
});

void import('./kkbox-history-ui.js?v=20261004.2').then(({ initKkboxHistoryUi }) => initKkboxHistoryUi());
void import('./qq-japan-chart-ui.js?v=20261004.1').then(({ initQqJapanHistoryUi }) => initQqJapanHistoryUi());
