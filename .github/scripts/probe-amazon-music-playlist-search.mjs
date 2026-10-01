import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const TARGET_TRACK_ID = 'B0DJLRN1LF';
const QUERY = 'TOKYO SNOW 櫻坂46';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
let capturedHeaders = null;

function deepStrings(value, out = [], depth = 0) {
  if (depth > 20 || value == null || out.length > 12000) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => deepStrings(v, out, depth + 1)); return out; }
  if (typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out, depth + 1));
  return out;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['text', 'value', 'label', 'title']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return null;
}

function playlistCandidates(root) {
  const out = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 18 || value == null) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    const strings = deepStrings(value, [], 0);
    const deeplink = strings.find((s) => /^\/(?:user-)?playlists\/[A-Za-z0-9_-]+$/iu.test(String(s)));
    const detail = strings.find((s) => /\/api\/showCatalogPlaylist\?id=[A-Za-z0-9_-]+/iu.test(String(s)));
    if (deeplink && detail) {
      const publicId = String(deeplink).split('/').pop();
      let internalId = null;
      try { internalId = new URL(detail).searchParams.get('id'); } catch {}
      if (publicId && internalId && !seen.has(`${publicId}:${internalId}`)) {
        seen.add(`${publicId}:${internalId}`);
        out.push({ public_id: publicId, internal_id: internalId, title: textValue(value.primaryText) || textValue(value.headerText) || null });
      }
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(root);
  return out.slice(0, 30);
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

async function skill(path, request) {
  return page.evaluate(async ({ path, request, capturedHeaders }) => {
    const response = await fetch(`https://fe.mesk.skill.music.a2z.com/api${path}`, {
      method: 'POST',
      headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...request, headers: capturedHeaders }),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: response.status, json, error: json ? null : text.slice(0, 800) };
  }, { path, request, capturedHeaders });
}

page.on('request', (request) => {
  if (!request.url().endsWith('/api/showSearch')) return;
  try {
    const body = JSON.parse(request.postData() || '{}');
    if (body.headers) capturedHeaders = body.headers;
  } catch {}
});

await page.goto(`https://music.amazon.co.jp/search/${encodeURIComponent(QUERY)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
if (!capturedHeaders) throw new Error('showSearch headers were not captured');

const search = await skill('/searchCatalogPlaylists', { keyword: QUERY, userHash: USER_HASH });
const candidates = search.json ? playlistCandidates(search.json) : [];
const output = [{ type: 'search', status: search.status, candidate_count: candidates.length, candidates, error: search.error }];

for (const candidate of candidates.slice(0, 15)) {
  const detail = await skill('/showCatalogPlaylist', { id: candidate.internal_id, userHash: USER_HASH });
  let pages = 1;
  let containsTarget = Boolean(detail.json && deepStrings(detail.json).some((v) => String(v).includes(TARGET_TRACK_ID)));
  let next = detail.json ? nextTracksRequest(detail.json) : null;
  while (!containsTarget && next && pages < 20) {
    const pageResult = await skill('/showCatalogTracks', next);
    pages += 1;
    if (!pageResult.json) break;
    containsTarget = deepStrings(pageResult.json).some((v) => String(v).includes(TARGET_TRACK_ID));
    next = nextTracksRequest(pageResult.json);
  }
  output.push({ type: 'verify', ...candidate, detail_status: detail.status, pages_checked: pages, contains_target: containsTarget });
}

console.log(JSON.stringify(output, null, 2));
await browser.close();
