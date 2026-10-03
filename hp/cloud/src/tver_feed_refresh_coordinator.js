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

export class VideoFeedCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.base = null;
  }

  async baseCoordinator() {
    if (this.base) return this.base;
    const { VideoFeedCoordinator: BaseVideoFeedCoordinator } = await import('../../video/src/video-feed-coordinator.js');
    this.base = new BaseVideoFeedCoordinator(this.state, this.env);
    return this.base;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== REFRESH_PATH) {
      return (await this.baseCoordinator()).fetch(request);
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    const [{ refreshTverFeed }, { enrichTverFeedEpisodeTitles }] = await Promise.all([
      import('./tver_feed.js'),
      import('./tver_feed_titles.js'),
    ]);
    const collectedFeed = await refreshTverFeed(this.env);
    const feed = await enrichTverFeedEpisodeTitles(this.env, collectedFeed);
    return Response.json({
      ok: true,
      generatedAt: feed.generatedAt,
      episodeCount: feed.episodeCount,
      sources: feed.sources,
      titledEpisodeCount: Array.isArray(feed.episodes)
        ? feed.episodes.filter((episode) => String(episode?.title || '').trim()).length
        : 0,
    });
  }
}

export const TVER_FEED_COORDINATOR_NAME = COORDINATOR_NAME;
export const TVER_FEED_REFRESH_PATH = REFRESH_PATH;
