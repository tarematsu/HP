import { publishAmazonMusicSakamichiModel } from '../src/amazon-music-sakamichi-publisher.js';
import { startAmazonDaily50kScan } from '../src/amazon-music-daily-50k.js';
import { amazonMusicServiceEnv } from '../src/music-service-other-store.js';

export async function refreshAmazonModel(env, { collect = false, now = Date.now(), dependencies = {} } = {}) {
  if (!collect) return (dependencies.publish || publishAmazonMusicSakamichiModel)(env, now);
  const scan = await (dependencies.collect || startAmazonDaily50kScan)(amazonMusicServiceEnv(env), now);
  if (!scan.complete || !scan.published?.published) throw new Error('Amazon Music recollection did not publish a complete scan');
  const object = await env.PAGES_RESPONSE_R2.get('amazon-music/read-model/latest.json');
  const model = await object?.json();
  if (!model || model.observed_at !== now) throw new Error('Amazon Music recollection publication is not current');
  return { ...scan.published, scan, groups: Object.fromEntries(['乃木坂46', '櫻坂46', '日向坂46'].map((group) => [
    group, (model.tracks || []).filter((track) => track.group_name === group && track.amazon_rank != null).length,
  ])) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ready');
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });
    try {
      const result = await refreshAmazonModel(env, { collect: url.searchParams.get('collect') === '1' });
      return Response.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error) }, {
        status: 500, headers: { 'cache-control': 'no-store' },
      });
    }
  },
};
