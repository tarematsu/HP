import {
  mountMusicServiceView,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

const artistTable = musicServiceTable({
  headers: ['アーティスト', '登録者', '月間視聴者', '総視聴回数', 'サービスID'],
  bodyId: 'youtubeMusicArtistBody',
});

const releaseTable = musicServiceTable({
  headers: ['アーティスト', '作品', '種別', '年'],
  bodyId: 'youtubeMusicReleaseBody',
});

const trackTable = musicServiceTable({
  headers: ['アーティスト', '曲名', '再生数', 'アルバム', 'videoId'],
  bodyId: 'youtubeMusicTrackBody',
});

const playlistTable = musicServiceTable({
  kind: 'playlist',
  headers: ['プレイリスト', '種別', '対象曲数'],
  bodyId: 'youtubeMusicPlaylistBody',
});

mountMusicServiceView({
  viewId: 'youtubeMusicView',
  className: 'youtube-music-view',
  noticeId: 'youtubeMusicNotice',
  meta: { valueId: 'youtubeMusicUpdated', cadence: '毎日0:00' },
  sections: [
    musicServiceSection({ id: 'youtubeMusicArtistSection', title: 'YouTube Music アーティスト', bodyHtml: artistTable }),
    musicServiceSection({ id: 'youtubeMusicReleaseSection', title: 'YouTube Music アルバム・シングル', bodyHtml: releaseTable }),
    musicServiceSection({ id: 'youtubeMusicTrackSection', title: 'YouTube Music 楽曲', bodyHtml: trackTable }),
    musicServiceSection({ id: 'youtubeMusicPlaylistSection', title: 'YouTube Music 公開プレイリスト', bodyHtml: playlistTable }),
  ],
});
