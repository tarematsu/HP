// Latest song likes, ranking cards, table and CSV output.
import { appendEmptyTableRow, finiteNumber as finite } from '../dashboard-ui-common.js?v=20261004.1';
import { role, setText, numberText, reducedImage, jstDateTime } from './view-utils.js';
import { appendTableRow } from '../dashboard-table-dom.js?v=20261001.1';
import { downloadCsv } from '../csv-download.js?v=20261001.1';

const MEDALS = ['🥇', '🥈', '🥉'];

function likeThumbnail(row) { const box = document.createElement('span'); box.className = 'like-rank-thumb'; const source = reducedImage(row.thumbnail_url); if (!source) { box.textContent = '♪'; box.classList.add('is-fallback'); return box; } const image = document.createElement('img'); image.src = source; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => { image.remove(); box.textContent = '♪'; box.classList.add('is-fallback'); }, { once: true }); box.append(image); return box; }

export function renderLikes(runtime, rows) {
  runtime.likes = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => Number(b.like_count || 0) - Number(a.like_count || 0)); setText(runtime.root, 'likes-count', numberText(runtime.likes.length)); const latest = runtime.likes.reduce((value, row) => Math.max(value, finite(row.observed_at) || 0), 0); setText(runtime.root, 'likes-latest', latest ? `${jstDateTime.format(new Date(latest))} JST` : '—');
  const list = role(runtime.root, 'likes-ranking'); if (list) { list.replaceChildren(); for (const [index, row] of runtime.likes.slice(0, 10).entries()) { const item = document.createElement('li'); item.className = 'like-rank-item'; const rank = document.createElement('strong'); rank.className = 'like-rank-number'; rank.textContent = MEDALS[index] || String(index + 1); const content = document.createElement('div'); content.className = 'like-rank-content'; const heading = document.createElement('div'); heading.className = 'like-rank-heading'; const title = document.createElement('span'); title.textContent = row.title || '曲名不明'; heading.append(title); const artist = document.createElement('small'); artist.textContent = row.artist || '—'; content.append(heading, artist); const metrics = document.createElement('div'); metrics.className = 'like-rank-metrics'; const metric = document.createElement('span'); metric.append('最新いいね数'); const strong = document.createElement('b'); strong.textContent = numberText(row.like_count); metric.append(strong); metrics.append(metric); item.append(rank, likeThumbnail(row), content, metrics); list.append(item); } }
  const body = role(runtime.root, 'likes-tbody'); if (body) { body.replaceChildren(); if (!runtime.likes.length) appendEmptyTableRow(body, 'いいねデータがありません。', 5); else runtime.likes.forEach((row, index) => appendTableRow(body, [index + 1, row.title || '曲名不明', row.artist || '—', numberText(row.like_count), row.observed_at ? `${jstDateTime.format(new Date(row.observed_at))} JST` : '—'])); }
}

export function exportLikesCsv(runtime) {
  downloadCsv(`${runtime.model.source}-like-ranking-${new Date().toISOString().slice(0, 10)}.csv`, [['順位', '曲名', 'アーティスト', '最新いいね数', '最終取得'], ...runtime.likes.map((row, index) => [index + 1, row.title || '曲名不明', row.artist || '', row.like_count ?? '', row.observed_at ? new Date(row.observed_at).toISOString() : ''])]);
}
