import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('HTTP startup forwards the real DO cached redirect without following it', async () => {
  const namespace = (env as unknown as { VIDEO_FEED_COORDINATOR: DurableObjectNamespace }).VIDEO_FEED_COORDINATOR;
  const stub = namespace.getByName('youtube-playlist-start');
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.put('youtube-playlist-start-v1', {
      expiresAt: Date.now() + 3600000,
      body: JSON.stringify({ playlistId: 'PLMWqSdpIVl30', videoId: 'AbCdEfGhI12', resolvedAt: new Date().toISOString() }),
    });
  });
  const response = await SELF.fetch('https://cloud.test/v1/native/youtube-start', { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('https://www.youtube.com/watch?v=AbCdEfGhI12&list=PLMWqSdpIVl30');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-homepanel-youtube-start')).toBe('cloud-cache');
});
