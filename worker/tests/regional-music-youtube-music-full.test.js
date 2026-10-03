import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseYouTubeMusicArtistPage,
  parseYouTubeMusicTrackPage,
} from '../src/regional-music-youtube-music.js';

function songRow(videoId, title, plays) {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      flexColumns: [{
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: title }] },
        },
      }, {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: '櫻坂46' }] },
        },
      }, {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: `${plays} plays` }] },
        },
      }],
      overlay: {
        musicItemThumbnailOverlayRenderer: {
          content: {
            musicPlayButtonRenderer: {
              playNavigationEndpoint: {
                watchEndpoint: {
                  videoId,
                  watchEndpointMusicSupportedConfigs: {
                    watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

test('artist page exposes the Songs browse id used for the complete catalog', () => {
  const payload = {
    header: {
      musicImmersiveHeaderRenderer: {
        title: { runs: [{ text: '櫻坂46' }] },
        subscriptionButton: { subscribeButtonRenderer: {} },
      },
    },
    contents: [{
      musicShelfRenderer: {
        title: {
          runs: [{
            text: 'Songs',
            navigationEndpoint: { browseEndpoint: { browseId: 'VLPL-full-songs' } },
          }],
        },
        contents: [songRow('song-1', 'Song One', '1.2M')],
      },
    }],
  };

  const parsed = parseYouTubeMusicArtistPage(payload, 'sakurazaka46');
  assert.equal(parsed.songsBrowseId, 'VLPL-full-songs');
});

test('full song pages parse track plays and the next browse continuation token', () => {
  const payload = {
    onResponseReceivedActions: [{
      appendContinuationItemsAction: {
        continuationItems: [
          songRow('song-2', 'Song Two', '987K'),
          {
            continuationItemRenderer: {
              continuationEndpoint: {
                continuationCommand: {
                  token: 'next-page-token',
                  request: 'CONTINUATION_REQUEST_TYPE_BROWSE',
                },
              },
            },
          },
        ],
      },
    }],
  };

  const parsed = parseYouTubeMusicTrackPage(payload, 'sakurazaka46');
  assert.equal(parsed.continuationToken, 'next-page-token');
  assert.deepEqual(parsed.tracks, [{
    service_track_id: 'song-2',
    title: 'Song Two',
    album_name: null,
    track_url: 'https://music.youtube.com/watch?v=song-2',
    plays: 987000,
  }]);
});
