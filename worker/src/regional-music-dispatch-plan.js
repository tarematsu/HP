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

export const REGIONAL_MUSIC_DISPATCH_UTC_HOUR = 21; // 06:00 JST

export function regionalMusicDispatchForTimestamp(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime()) || date.getUTCHours() !== REGIONAL_MUSIC_DISPATCH_UTC_HOUR) return null;

  const minute = date.getUTCMinutes();
  if (minute >= REGIONAL_MUSIC_DAILY_SERVICES.length) return null;
  return {
    message_type: 'regional-music-collect',
    service: REGIONAL_MUSIC_DAILY_SERVICES[minute],
    scheduled_at: date.getTime(),
  };
}

export async function enqueueRegionalMusicDispatch(env, timestamp) {
  const message = regionalMusicDispatchForTimestamp(timestamp);
  if (!message) return null;
  if (!env?.REGIONAL_MUSIC_QUEUE?.send) throw new Error('REGIONAL_MUSIC_QUEUE binding is missing');
  await env.REGIONAL_MUSIC_QUEUE.send(message);
  return message;
}
