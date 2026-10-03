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

export const REGIONAL_MUSIC_CADENCE = Object.freeze({
  qq_music: '毎週木曜日18:00',
  kugou_music: '平日11:30 / ACG新歌榜: 水曜11:40',
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

export function loadRegionalMusicReadModel(service) {
  const serviceId = String(service || '').trim();
  if (!serviceId) return Promise.reject(new Error('regional music service is required'));
  if (!readModelPromises.has(serviceId)) {
    const request = fetch(`/api/regional-music?service=${encodeURIComponent(serviceId)}`, {
      headers: { accept: 'application/json' },
      cache: 'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`regional music ${serviceId} HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || payload.service !== serviceId) {
        throw new Error(payload?.error || `regional music ${serviceId} read model unavailable`);
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
