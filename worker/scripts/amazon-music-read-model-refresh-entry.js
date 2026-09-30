import { publishAmazonMusicSakamichiModel } from '../src/amazon-music-sakamichi-publisher.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });
    const result = await publishAmazonMusicSakamichiModel(env, Date.now());
    return Response.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  },
};
