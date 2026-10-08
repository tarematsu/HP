// Shared leaderboard rank and update-time formatting.
import { safeInteger as integer } from '../dashboard-ui-common.js?v=20261004.1';

const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatUpdatedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '-' : jstDateTime.format(date);
}

export function rankValue(value) {
  const parsed = integer(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

