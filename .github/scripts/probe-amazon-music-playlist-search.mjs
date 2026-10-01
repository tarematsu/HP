import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const TARGET_TRACK_ID = 'B0DJLRN1LF';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
let capturedHeaders = null;

function deepStrings(value, out = [], depth = 0) {
  if (depth > 22 || value == null || out.length > 20000) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => deepStrings(v, out, depth + 1)); return out; }
  if (typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out, depth + 1));
  return out;
}

function text(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['text', 'value', 'label', 'title']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return null;
}

function playlistEntries(root) {
  const rows = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 20 || value == null) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    const strings = deepStrings(value, [], 0);
    const deeplink = strings.find((s) => /^\/(?:user-)?playlists\/[A-Za-z0-9_-]+$/iu.test(String(s)));
    const detail = strings.find((s) => /\/api\/showCatalogPlaylist\?id=[A-Za-z0-9_-]+/iu.test(String(s)));
    if (deeplink) {
      const publicId = String(deeplink).split('/').pop();
      let internalId = null;
      if (detail) {
        try { internalId = new URL(detail).searchParams.get('id'); } catch {}
      }
      const key = `${publicId}:${internalId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({
          public_id: publicId,
          internal_id: internalId,
          name: text(value.primaryText) || text(value.headerText) || text(value.title) || null,
          url: `https://music.amazon.co.jp/playlists/${publicId}`,
        });
      }
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(root);
  return rows;
}

function nextTracksRequest(root) {
  for (const value of deepStrings(root)) {
    if (!String(value).includes('/api/showCatalogTracks?') || !String(value).includes('next=')) continue;
    try {
      const url = new URL(value);
      const id = url.searchParams.get('id');
      const next = url.searchParams.get('next');
      if (id && next) return { id, next, userHash: url.searchParams.get('userHash') || USER_HASH };
    } catch {}
  }
  return null;
}

function nextRelatedRequest(root) {
  for (const value of deepStrings(root)) {
    if (!String(value).includes('/api/cosmicTrack/showTrackDetailSeeMore?') || !String(value).includes('related-playlists')) continue;
    try {
      const url = new URL(value);
      const next = url.searchParams.get('next');
      if (next) return {
        id: url.searchParams.get('id') || TARGET_TRACK_ID,
        pageType: 'related-playlists',
        next,
        userHash: url.searchParams.get('userHash') || USER_HASH,
      };
    } catch {}
  }
  return null;
}

async function skill(path, request) {
  return page.evaluate(async ({ path, request, capturedHeaders }) => {
    const response = await fetch(`https://fe.mesk.skill.music.a2z.com/api${path}`, {
      method: 'POST',
      headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...request, headers: capturedHeaders }),
    });
    const raw = await response.text();
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    return { status: response.status, json, error: json ? null : raw.slice(0, 1000) };
  }, { path, request, capturedHeaders });
}

page.on('request', (request) => {
  if (!request.url().endsWith('/api/showSearch')) return;
  try {
    const body = JSON.parse(request.postData() || '{}');
    if (body.headers) capturedHeaders = body.headers;
  } catch {}
});

await page.goto('https://music.amazon.co.jp/search/TOKYO%20SNOW%20%E6%AB%BB%E5%9D%8246', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
if (!capturedHeaders) throw new Error('showSearch headers were not captured');

const all = [];
let request = { id: TARGET_TRACK_ID, pageType: 'related-playlists', userHash: USER_HASH };
for (let pageIndex = 0; pageIndex < 10 && request; pageIndex += 1) {
  const result = await skill('/cosmicTrack/showTrackDetailSeeMore', request);
  if (!result.json) {
    console.log(JSON.stringify({ type: 'error', page: pageIndex + 1, status: result.status, error: result.error }, null, 2));
    break;
  }
  for (const row of playlistEntries(result.json)) {
    if (!all.some((item) => item.public_id === row.public_id)) all.push(row);
  }
  const next = nextRelatedRequest(result.json);
  request = next && next.next !== request.next ? next : null;
}

const verified = [];
for (const playlist of all.slice(0, 30)) {
  if (!playlist.internal_id) {
    verified.push({ ...playlist, verified: false, reason: 'catalog-id-missing' });
    continue;
  }
  const detail = await skill('/showCatalogPlaylist', { id: playlist.internal_id, userHash: USER_HASH });
  let contains = Boolean(detail.json && deepStrings(detail.json).some((v) => String(v).includes(TARGET_TRACK_ID)));
  let pages = 1;
  let next = detail.json ? nextTracksRequest(detail.json) : null;
  while (!contains && next && pages < 30) {
    const part = await skill('/showCatalogTracks', next);
    pages += 1;
    if (!part.json) break;
    contains = deepStrings(part.json).some((v) => String(v).includes(TARGET_TRACK_ID));
    next = nextTracksRequest(part.json);
  }
  verified.push({ ...playlist, verified: contains, pages_checked: pages, status: detail.status });
}

console.log(JSON.stringify({ track_id: TARGET_TRACK_ID, related_count: all.length, related: all, verified }, null, 2));
await browser.close();
