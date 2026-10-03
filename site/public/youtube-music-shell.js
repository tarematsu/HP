import {
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';
import {
  musicServiceMeta,
  musicServiceSection,
  musicServiceViewClassName,
} from './music-service-shell.js?v=20261004.1';

const artistTable = dashboardTable({
  className: 'regional-music-table music-service-track-table',
  headers: ['アーティスト', '登録者', '月間視聴者', '総視聴回数', 'サービスID'],
  bodyId: 'youtubeMusicArtistBody',
});

const releaseTable = dashboardTable({
  className: 'regional-music-table music-service-track-table',
  headers: ['アーティスト', '作品', '種別', '年'],
  bodyId: 'youtubeMusicReleaseBody',
});

const trackTable = dashboardTable({
  className: 'regional-music-table music-service-track-table',
  headers: ['アーティスト', '曲名', '再生数', 'アルバム', 'videoId'],
  bodyId: 'youtubeMusicTrackBody',
});

const playlistTable = dashboardTable({
  className: 'regional-music-table music-service-playlist-table',
  headers: ['プレイリスト', '種別', '対象曲数'],
  bodyId: 'youtubeMusicPlaylistBody',
});

mountDashboardShell({
  view: {
    id: 'youtubeMusicView',
    className: musicServiceViewClassName('youtube-music-view'),
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'youtubeMusicUpdated', cadence: '毎日0:00' })}
      ${dashboardNotice({ id: 'youtubeMusicNotice' })}
      ${musicServiceSection({ id: 'youtubeMusicArtistSection', title: 'YouTube Music アーティスト', bodyHtml: artistTable })}
      ${musicServiceSection({ id: 'youtubeMusicReleaseSection', title: 'YouTube Music アルバム・シングル', bodyHtml: releaseTable })}
      ${musicServiceSection({ id: 'youtubeMusicTrackSection', title: 'YouTube Music 楽曲', bodyHtml: trackTable })}
      ${musicServiceSection({ id: 'youtubeMusicPlaylistSection', title: 'YouTube Music 公開プレイリスト', bodyHtml: playlistTable })}`,
  },
});
