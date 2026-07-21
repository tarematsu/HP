const SOURCE_URLS = Object.freeze({
  A: 'https://twixive.net/ranking',
  B: 'https://twivideo.net/?ranking',
  E: 'https://www.twikeep.com/ranking?range=24h&metric=views'
});

const DEFAULT_MEDIA_HOST = 'video.twimg.com';

export function sourceUrlFor(env, key) {
  const sourceKey = String(key || '').toUpperCase();
  const envKey = `SOURCE_${sourceKey}_URL`;
  if (env?.[envKey]) return env[envKey];
  const sourceUrl = SOURCE_URLS[sourceKey];
  if (!sourceUrl) throw new Error(`Unknown source key: ${sourceKey}`);
  return sourceUrl;
}

export function mediaHostFor(env) {
  if (env?.MEDIA_HOST) return env.MEDIA_HOST;
  return DEFAULT_MEDIA_HOST;
}

export { SOURCE_URLS };
