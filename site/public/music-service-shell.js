import { dashboardDataCard, dashboardTable } from './dashboard-ui-common.js?v=20261001.1';

export function musicServiceMeta({ label = '集計日', valueId } = {}) {
  return `<div class="music-service-meta">${label} <time${valueId ? ` id="${valueId}"` : ''}>-</time></div>`;
}

export function musicServiceSection({ id = '', kicker = '', title = '', bodyHtml = '' } = {}) {
  return `<section${id ? ` id="${id}"` : ''} class="music-service-section">
    <header class="music-service-section-heading">
      <div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}<h2>${title}</h2></div>
    </header>
    ${bodyHtml}
  </section>`;
}

export function musicServicePlaylistCard({
  tableId,
  title = '楽曲別プレイリスト掲載一覧',
  titleId = '',
  note = '公開ページ上で検出できたプレイリストを表示します。',
  className = '',
} = {}) {
  const table = dashboardTable({
    id: tableId,
    className: 'music-service-playlist-table',
    wrapClassName: 'table-fit-mobile',
  });
  return dashboardDataCard({
    title,
    titleId,
    kicker: 'PLAYLISTS',
    className: `music-service-panel ${className}`.trim(),
    bodyHtml: `<p class="music-service-playlist-note">${note}</p>${table}`,
  });
}
