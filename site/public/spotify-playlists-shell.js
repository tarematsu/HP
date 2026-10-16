import { mountMusicServiceView, musicServiceFilterTabs, musicServiceSection, musicServiceTable, musicServiceRankChart } from './music-service-shell.js?v=20261004.2';
import { SPOTIFY_PLAYLIST_TABS } from './spotify-playlists-catalog.js';

const artists = musicServiceFilterTabs([
  { value: 'all', label: 'すべて', active: true },
  { value: 'sakurazaka46', label: '櫻坂' }, { value: 'nogizaka46', label: '乃木坂' },
  { value: 'hinatazaka46', label: '日向坂' }, { value: 'sakamichi-selection', label: '坂道選抜' },
], { dataAttribute: 'spotify-playlist-artist', ariaLabel: 'Spotifyプレイリスト 表示グループ' });
const labels = Object.fromEntries(SPOTIFY_PLAYLIST_TABS.map(({ slug, label }) => [slug, label]));
const sections = SPOTIFY_PLAYLIST_TABS.flatMap(({ slug, label }) => [
  musicServiceSection({
    group: slug, title: `${label} 掲載位置推移`,
    bodyHtml: `<p id="spotifyPlaylistStatus-${slug}" class="shared-note"></p>`
      + musicServiceRankChart({ legendId: `spotifyPlaylistLegend-${slug}`, chartId: `spotifyPlaylistPlot-${slug}` }),
  }),
  musicServiceSection({
    group: slug, title: `${label} 掲載履歴`,
    bodyHtml: musicServiceTable({
      headers: ['日付', 'グループ', '掲載位置', '曲名'],
      bodyId: `spotifyPlaylistBody-${slug}`,
      className: 'dashboard-responsive-table spotify-chart-history-table',
    }) + `<div id="spotifyPlaylistCards-${slug}" class="dashboard-responsive-cards spotify-chart-responsive-cards" aria-label="${label}掲載履歴"></div>`
      + `<div id="spotifyPlaylistPager-${slug}" class="music-service-pager" aria-label="${label}一覧のページ切替"></div>`,
  }),
]);
mountMusicServiceView({
  viewId: 'spotifyPlaylistsView', className: 'spotify-view', noticeId: 'spotifyPlaylistsNotice',
  groupLabels: labels, meta: { valueId: 'spotifyPlaylistsUpdatedAt', cadence: '日次スナップショット（日本時間）' },
  beforeSectionsHtml: artists
    + '<p class="shared-note">Spotify公式編集プレイリストの掲載順です。再生数チャートや旧バイラル50の順位ではありません。取得開始後の履歴のみ記録します。</p>',
  sections,
});
