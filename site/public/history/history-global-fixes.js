const style = document.createElement('style');
style.dataset.pagesHistoryGlobalFixes = '1';
style.textContent = `
  .dashboard-view .data-panel {
    content-visibility: visible !important;
    contain-intrinsic-size: none !important;
  }
  .likes-view .table-wrap,
  .likes-view table,
  .likes-view thead,
  .likes-view tbody,
  .likes-view tr,
  .likes-view th,
  .likes-view td {
    content-visibility: visible !important;
    contain: none !important;
  }
  .dashboard-view .summary-cards strong {
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: clip !important;
    overflow-wrap: normal !important;
    font-size: clamp(1.15rem, 1.8vw, 1.55rem) !important;
    line-height: 1 !important;
  }
`;
document.head.appendChild(style);

function finiteRank(text) {
  const value = String(text ?? '').trim();
  return value !== '' && /^\d+(?:\.\d+)?$/.test(value);
}

function repairRankingSummary() {
  if (location.hash !== '#ranking') return;
  const body = document.getElementById('tbody');
  if (!body) return;
  const rows = [...body.querySelectorAll('tr')].filter((row) => row.querySelectorAll('td').length >= 3);
  if (!rows.length) return;

  const ranked = rows.filter((row) => finiteRank(row.querySelectorAll('td')[2]?.textContent)).length;
  const outOfRank = rows.length - ranked;
  const hosts = new Set(rows.map((row) => row.querySelectorAll('td')[1]?.textContent?.trim()).filter(Boolean));
  const formatter = new Intl.NumberFormat('ja-JP');
  const labels = [
    ['periodLabel', '順位行'],
    ['maxLabel', '掲載行'],
    ['streamLabel', '圏外行'],
    ['memberLabel', '対象ホスト'],
  ];
  const values = [
    ['periods', rows.length],
    ['maxListener', ranked],
    ['streamGrowth', outOfRank],
    ['memberGrowth', hosts.size],
  ];
  for (const [id, text] of labels) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }
  for (const [id, value] of values) {
    const node = document.getElementById(id);
    if (node) node.textContent = formatter.format(value);
  }
}

let rankingRepairFrame = 0;
function scheduleRankingRepair() {
  cancelAnimationFrame(rankingRepairFrame);
  rankingRepairFrame = requestAnimationFrame(() => {
    rankingRepairFrame = requestAnimationFrame(repairRankingSummary);
  });
}

const rankingBody = document.getElementById('tbody');
if (rankingBody) new MutationObserver(scheduleRankingRepair).observe(rankingBody, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleRankingRepair);
window.addEventListener('history:runtime-ready', scheduleRankingRepair);
scheduleRankingRepair();

function placeholderTitle(value) {
  const normalized = String(value ?? '').trim().normalize('NFKC').toLowerCase();
  return !normalized
    || ['曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '-', '—'].includes(normalized);
}

function spotifyTrackId(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/track\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

let metadataPromise = null;
async function loadTrackMetadata() {
  if (metadataPromise) return metadataPromise;
  metadataPromise = (async () => {
    const response = await fetch('/api/track-history?ranking_only=1&ranking_limit=500', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`track metadata HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.ranking) ? payload.ranking : [];
    const map = new Map();
    for (const row of rows) {
      const spotifyId = String(row?.spotify_id || '').trim();
      const title = String(row?.title || '').trim();
      if (!spotifyId || placeholderTitle(title)) continue;
      map.set(spotifyId, {
        title,
        artist: String(row?.artist || '').trim(),
      });
    }
    return map;
  })().catch((error) => {
    console.warn('track metadata recovery unavailable', error);
    setTimeout(() => { metadataPromise = null; }, 60_000);
    return new Map();
  });
  return metadataPromise;
}

async function repairPlaybackMetadata() {
  const currentView = document.getElementById('currentView');
  if (!currentView || currentView.hidden) return;
  const candidates = [];
  const nowLink = document.getElementById('nowPlayingLink');
  const nowTitle = document.getElementById('trackTitle');
  const nowArtist = document.getElementById('trackArtist');
  const nowId = spotifyTrackId(nowLink?.getAttribute('href'));
  if (nowId && (placeholderTitle(nowTitle?.textContent) || !String(nowArtist?.textContent || '').trim())) {
    candidates.push({ id: nowId, title: nowTitle, artist: nowArtist });
  }
  for (const link of currentView.querySelectorAll('.queue-item[href]')) {
    const id = spotifyTrackId(link.getAttribute('href'));
    const title = link.querySelector('.queue-copy strong');
    const artist = link.querySelector('.queue-copy small');
    if (id && (placeholderTitle(title?.textContent) || !String(artist?.textContent || '').trim())) {
      candidates.push({ id, title, artist });
    }
  }
  if (!candidates.length) return;
  const metadata = await loadTrackMetadata();
  for (const candidate of candidates) {
    const recovered = metadata.get(candidate.id);
    if (!recovered) continue;
    if (candidate.title && placeholderTitle(candidate.title.textContent)) candidate.title.textContent = recovered.title;
    if (candidate.artist && !String(candidate.artist.textContent || '').trim() && recovered.artist) {
      candidate.artist.textContent = recovered.artist;
    }
  }
}

let metadataRepairFrame = 0;
function scheduleMetadataRepair() {
  cancelAnimationFrame(metadataRepairFrame);
  metadataRepairFrame = requestAnimationFrame(() => { void repairPlaybackMetadata(); });
}

const currentView = document.getElementById('currentView');
if (currentView) {
  new MutationObserver(scheduleMetadataRepair).observe(currentView, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });
}
window.addEventListener('hashchange', scheduleMetadataRepair);
scheduleMetadataRepair();
