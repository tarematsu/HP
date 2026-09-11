import { VideoFeedCoordinator as BaseVideoFeedCoordinator } from '../../video/src/video-feed-coordinator.js';
import { refreshTverFeed } from './tver_feed.js';

const COORDINATOR_NAME = 'tver-feed-refresh';
const REFRESH_PATH = '/tver-feed-refresh-run';
const REFRESH_URL = `https://homepanel.internal${REFRESH_PATH}`;

export async function dispatchTverFeedRefresh(env) {
  const namespace = env?.VIDEO_FEED_COORDINATOR;
  if (!namespace?.getByName) {
    throw new Error('VIDEO_FEED_COORDINATOR binding unavailable');
  }
  const response = await namespace
    .getByName(COORDINATOR_NAME)
    .fetch(REFRESH_URL, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`TVer feed coordinator returned ${response.status}`);
  }
  return response.json();
}

export class VideoFeedCoordinator extends BaseVideoFeedCoordinator {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== REFRESH_PATH) return super.fetch(request);
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    const feed = await refreshTverFeed(this.env);
    return Response.json({
      ok: true,
      generatedAt: feed.generatedAt,
      episodeCount: feed.episodeCount,
      sources: feed.sources,
    });
  }
}

export const TVER_FEED_COORDINATOR_NAME = COORDINATOR_NAME;
export const TVER_FEED_REFRESH_PATH = REFRESH_PATH;
