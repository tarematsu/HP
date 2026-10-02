export const REGIONAL_MUSIC_DAILY_SERVICES = Object.freeze([
  'genie',
  'bugs',
  'joox',
  'nhaccuatui',
  'anghami',
  'melon',
  'qq_music',
  'netease_cloud_music',
  'kugou_music',
  'naver_vibe',
  'flo',
  'yandex_music',
  'boomplay',
  'plern',
  'fungjai',
  'zing_mp3',
  'jiosaavn',
  'gaana',
  'langit_musik',
]);

export const REGIONAL_MUSIC_DISPATCH_UTC_HOUR = 15; // 00:00 JST; Actions owns the standard collection run.
export const REGIONAL_MUSIC_EVERY_DAY = Object.freeze(['netease_cloud_music']);
export const REGIONAL_MUSIC_WEEKLY_SERVICES = Object.freeze(
  REGIONAL_MUSIC_DAILY_SERVICES.filter((service) => service !== 'qq_music'),
);
export const QQ_MUSIC_WEEKLY_JST_DAY = 4;
export const QQ_MUSIC_WEEKLY_JST_HOUR = 18;

export function regionalMusicR2DueServices(timestamp) {
  const date = new Date(Number(timestamp) + 9 * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid regional collection timestamp');
  const jstDay = date.getUTCDay();
  const jstHour = date.getUTCHours();

  if (jstDay === QQ_MUSIC_WEEKLY_JST_DAY && jstHour === QQ_MUSIC_WEEKLY_JST_HOUR) return ['qq_music'];
  if (jstHour !== 0) return [];
  return jstDay === 1 ? [...REGIONAL_MUSIC_WEEKLY_SERVICES] : [...REGIONAL_MUSIC_EVERY_DAY];
}

export function regionalMusicDispatchForTimestamp(timestamp) {
  // Removed: per-minute Worker/Queue collection. Scheduled Actions runs collect
  // only the services due for that JST cadence into R2.
  return null;
}

export async function enqueueRegionalMusicDispatch(env, timestamp) {
  const message = regionalMusicDispatchForTimestamp(timestamp);
  if (!message) return null;
  if (!env?.REGIONAL_MUSIC_QUEUE?.send) throw new Error('REGIONAL_MUSIC_QUEUE binding is missing');
  await env.REGIONAL_MUSIC_QUEUE.send(message);
  return message;
}
