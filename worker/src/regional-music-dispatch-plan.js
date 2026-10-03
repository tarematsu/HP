export const REGIONAL_MUSIC_DAILY_SERVICES = Object.freeze([
  'kkbox',
  'qq_music',
  'kugou_music',
]);

export const REGIONAL_MUSIC_DISPATCH_UTC_HOUR = 15; // 00:00 JST
export const REGIONAL_MUSIC_EVERY_DAY = Object.freeze([]);
export const REGIONAL_MUSIC_WEEKLY_SERVICES = Object.freeze(['kkbox']);
export const QQ_MUSIC_WEEKLY_JST_DAY = 4;
export const QQ_MUSIC_WEEKLY_JST_HOUR = 18;
export const KUGOU_MUSIC_WEEKDAY_JST_HOUR = 11;

export function regionalMusicR2DueServices(timestamp) {
  const date = new Date(Number(timestamp) + 9 * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid regional collection timestamp');
  const jstDay = date.getUTCDay();
  const jstHour = date.getUTCHours();
  if (jstDay === QQ_MUSIC_WEEKLY_JST_DAY && jstHour === QQ_MUSIC_WEEKLY_JST_HOUR) return ['qq_music'];
  if (jstDay >= 1 && jstDay <= 5 && jstHour === KUGOU_MUSIC_WEEKDAY_JST_HOUR) return ['kugou_music'];
  if (jstHour !== 0) return [];
  return jstDay === 1 ? [...REGIONAL_MUSIC_WEEKLY_SERVICES] : [...REGIONAL_MUSIC_EVERY_DAY];
}

export function regionalMusicDispatchForTimestamp(timestamp) {
  return null;
}

export async function enqueueRegionalMusicDispatch(env, timestamp) {
  const message = regionalMusicDispatchForTimestamp(timestamp);
  if (!message) return null;
  if (!env?.REGIONAL_MUSIC_QUEUE?.send) throw new Error('REGIONAL_MUSIC_QUEUE binding is missing');
  await env.REGIONAL_MUSIC_QUEUE.send(message);
  return message;
}
