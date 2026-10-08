import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

function artistFilter(label) {
  return musicServiceFilterTabs([
    { value: 'all', label: 'すべて', active: true },
    { value: 'sakurazaka46', label: '櫻坂' },
    { value: 'nogizaka46', label: '乃木坂' },
    { value: 'hinatazaka46', label: '日向坂' },
  ], {
    dataAttribute: 'qq-artist-filter',
    ariaLabel: label,
  });
}

function historyTable(bodyId) {
  return musicServiceTable({
    className: 'music-service-history-table',
    wrapClassName: 'music-service-table-wrap',
    headers: ['更新日', 'グループ', '順位', '曲名'],
    bodyId,
  });
}

const popularityTable = musicServiceTable({
  className: 'music-service-popularity-table',
  wrapClassName: 'music-service-table-wrap',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
});

mountMusicServiceView({
  viewId: 'qqMusicView',
  className: 'qq-music-view',
  noticeId: 'qqMusicNotice',
  meta: {
    valueId: 'qqMusicUpdatedAt',
    cadenceId: 'qqMusicCadence',
  },
  sections: [
    musicServiceSection({
      id: 'qqJapanChartSection',
      title: 'QQ音乐 日本榜 グループ別最高順位推移',
      bodyHtml: '<div id="qqJapanRankLegend" class="music-service-rank-legend" aria-label="グループ凡例"></div><div id="qqJapanRankChart" class="music-service-rank-chart"></div>',
    }),
    musicServiceSection({
      id: 'qqJapanHistorySection', group: 'list',
      title: 'QQ音乐 日本榜 ランクイン履歴',
      trailingHtml: artistFilter('QQ音乐 日本榜 表示グループ'),
      bodyHtml: historyTable('qqJapanHistoryBody'),
    }),
    musicServiceSection({
      id: 'qqAnimeChartSection',
      title: 'QQ音乐 动漫音乐榜 グループ別最高順位推移',
      bodyHtml: '<div id="qqAnimeRankLegend" class="music-service-rank-legend" aria-label="グループ凡例"></div><div id="qqAnimeRankChart" class="music-service-rank-chart"></div>',
    }),
    musicServiceSection({
      id: 'qqAnimeHistorySection', group: 'list',
      title: 'QQ音乐 动漫音乐榜 ランクイン履歴',
      trailingHtml: artistFilter('QQ音乐 动漫音乐榜 表示グループ'),
      bodyHtml: historyTable('qqAnimeHistoryBody'),
    }),
    musicServiceSection({
      id: 'qqArtistPopularitySection', group: 'list',
      title: 'QQ音乐 アーティスト別人気曲順位',
      bodyHtml: popularityTable,
    }),
  ],
});