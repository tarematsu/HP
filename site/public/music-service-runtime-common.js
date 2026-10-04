import { byId, integerFormat } from './dashboard-ui-common.js?v=20261001.1';
import { dashboardDateTimeFormatter } from './dashboard-time.js?v=20261001.1';

export const MUSIC_ARTIST_LABELS = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
  aobazaka46: '青葉坂46',
});

export const MUSIC_ARTIST_ORDER = Object.freeze([
  'sakurazaka46',
  'nogizaka46',
  'hinatazaka46',
  'aobazaka46',
]);

export const SAKAMICHI_GROUP_COLORS = Object.freeze({
  sakurazaka46: '#f3a6c8',
  nogizaka46: '#8264b0',
  hinatazaka46: '#9ecff3',
});

export const MUSIC_SERVICE_CADENCE = Object.freeze({
  youtube_music: '毎日0:00',
  kkbox: '-',
  qq_music: '毎週木曜日18:00',
  kugou_music: '平日11:30 / ACG新歌榜: 水曜11:40',
});

const MUSIC_SERVICE_ENDPOINTS = Object.freeze({
  youtube_music: '/api/youtube-music',
  kkbox: '/api/kkbox',
  qq_music: '/api/qq-music',
  kugou_music: '/api/kugou-music',
});

const dateTimeFormat = dashboardDateTimeFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const readModelPromises = new Map();

export function musicValueText(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return String(fallback);
  const number = Number(value);
  return Number.isFinite(number) ? integerFormat.format(number) : String(value);
}

export function musicDateTimeText(value, fallback = '-') {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return String(fallback);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? String(fallback) : dateTimeFormat.format(date);
}

export function replaceMusicTableBody(id) {
  const body = byId(id);
  if (body) body.replaceChildren();
  return body;
}

export function loadMusicServiceReadModel(service) {
  const serviceId = String(service || '').trim();
  const endpoint = MUSIC_SERVICE_ENDPOINTS[serviceId];
  if (!endpoint) return Promise.reject(new Error(`unknown music service: ${serviceId || '(empty)'}`));
  if (!readModelPromises.has(serviceId)) {
    const request = fetch(endpoint, {
      headers: { accept: 'application/json' },
      cache: 'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`${serviceId} HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || payload.service !== serviceId) {
        throw new Error(payload?.error || `${serviceId} read model unavailable`);
      }
      return payload;
    }).catch((error) => {
      readModelPromises.delete(serviceId);
      throw error;
    });
    readModelPromises.set(serviceId, request);
  }
  return readModelPromises.get(serviceId);
}