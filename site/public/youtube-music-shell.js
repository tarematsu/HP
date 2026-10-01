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
  dashboardSummaryItem({ label: '状態', valueId: 'youtubeMusicStatus' }),
  dashboardSummaryItem({ label: 'アーティスト', valueId: 'youtubeMusicArtistCount' }),
  dashboardSummaryItem({ label: '楽曲', valueId: 'youtubeMusicTrackCount' }),
  dashboardSummaryItem({ label: '作品', valueId: 'youtubeMusicReleaseCount' }),
], { className: 'music-service-summary', ariaLabel: 'YouTube Music概要' });

const artistTable = dashboardTable({
  className: 'music-service-track-table',
  headers: ['アーティスト', '登録者', '月間視聴者', '総視聴回数', 'サービスID'],
  bodyId: 'youtubeMusicArtistBody',
});

const releaseTable = dashboardTable({
  className: 'music-service-track-table',
  headers: ['アーティスト', '作品', '種別', '年'],
  bodyId: 'youtubeMusicReleaseBody',
});

const trackTable = dashboardTable({
  className: 'music-service-track-table',
  headers: ['アーティスト', '曲名', 'アルバム', 'videoId'],
  bodyId: 'youtubeMusicTrackBody',
});

const playlistTable = dashboardTable({
  className: 'music-service-playlist-table',
  headers: ['プレイリスト', '種別', '対象曲数'],
  bodyId: 'youtubeMusicPlaylistBody',
});

const healthPanel = dashboardDataCard({
  title: '収集状態',
  kicker: 'COLLECTOR',
  className: 'music-service-panel',
  bodyHtml: '<dl id="youtubeMusicHealth" class="regional-music-health-list"></dl>',
});

mountDashboardShell({
  view: {
    id: 'youtubeMusicView',
    className: 'youtube-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ label: '更新', valueId: 'youtubeMusicUpdated' })}
      ${dashboardNotice({ id: 'youtubeMusicNotice' })}
      <div class="regional-music-title-row">
        <div><p class="kicker">YOUTUBE MUSIC</p><h2>YouTube Music</h2></div>
        <span class="regional-music-region">JP / Global</span>
      </div>
      ${summary}
      <section id="youtubeMusicHealthSection" class="music-service-section">${healthPanel}</section>
      ${musicServiceSection({ id: 'youtubeMusicArtistSection', kicker: 'ARTISTS', title: 'アーティスト', bodyHtml: artistTable })}
      ${musicServiceSection({ id: 'youtubeMusicReleaseSection', kicker: 'RELEASES', title: 'アルバム・シングル', bodyHtml: releaseTable })}
      ${musicServiceSection({ id: 'youtubeMusicTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: trackTable })}
      ${musicServiceSection({ id: 'youtubeMusicPlaylistSection', kicker: 'PLAYLISTS', title: '公開プレイリスト', bodyHtml: playlistTable })}`,
  },
});
