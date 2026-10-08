// Shared DOM access and presentation values for channel views.
import { finiteNumber as finite, integerFormat as integer } from '../dashboard-ui-common.js?v=20261004.1';

export const DAY_MS = 86_400_000;
export const jstDateTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const jstDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const jstTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function role(root, name) { return root.querySelector(`[data-role="${name}"]`); }

export function numberText(value) { const n = finite(value); return n == null ? '—' : integer.format(Math.round(n)); }

export function signedText(value) { const n = finite(value); return n == null ? '—' : `${n >= 0 ? '+' : ''}${integer.format(Math.round(n))}`; }

export function setText(root, name, value) { const node = role(root, name); if (node) node.textContent = String(value); }

export function setNotice(root, text = '', error = false) { const node = role(root, 'notice'); if (!node) return; node.textContent = text; node.hidden = !text; node.classList.toggle('error', Boolean(error)); }

export function dateKey(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''; }

export function parseDate(value) { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? date : null; }

export function addDays(value, days) { const date = parseDate(value); if (!date) return ''; date.setUTCDate(date.getUTCDate() + days); return dateKey(date); }

export function weekStart(value) { const date = parseDate(value); if (!date) return ''; date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return dateKey(date); }

export function shortDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return match ? `${Number(match[2])}/${Number(match[3])}` : String(value || ''); }

export function reducedImage(source) { return String(source || '').trim(); }

export function trackArtist(track) { return String(track?.artist || track?.artist_name || track?.album_artist || '').trim(); }

export function durationText(ms) { const seconds = Math.max(0, Math.floor((finite(ms) || 0) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export function colorFor(index) { return `hsl(${Math.round((index * 137.508 + 332) % 360)} 72% 42%)`; }
