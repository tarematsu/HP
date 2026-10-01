import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'ja-JP' });
const TRACK_ID = 'B0DJLRN1LF';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
let capturedHeaders = null;

function walk(value, path = '$', out = [], depth = 0) {
  if (depth > 22 || value == null || out.length > 500) return out;
  if (typeof value === 'string') {
    if (/playlist|プレイリスト|showCatalogPlaylist|B0DJLRN1LF/i.test(value)) out.push({ path, value: value.slice(0, 5000) });
    return out;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, out, depth + 1)); return out; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/primaryText|secondaryText|header|title|deeplink|url|id/i.test(k)) {
        const rendered = typeof v === 'string' ? v : JSON.stringify(v);
        if (/playlist|プレイリスト|B0DJLRN1LF/i.test(rendered || '')) out.push({ path: `${path}.${k}`, value: String(rendered).slice(0, 5000) });
      }
      walk(v, `${path}.${k}`, out, depth + 1);
    }
  }
  return out;
}

page.on('request', (request) => {
  if (!request.url().endsWith('/api/showSearch')) return;
  try { const body = JSON.parse(request.postData() || '{}'); if (body.headers) capturedHeaders = body.headers; } catch {}
});

await page.goto('https://music.amazon.co.jp/search/TOKYO%20SNOW%20%E6%AB%BB%E5%9D%8246', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
if (!capturedHeaders) throw new Error('headers missing');

const result = await page.evaluate(async ({ capturedHeaders, id, userHash }) => {
  const response = await fetch('https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/showTrackDetailSeeMore', {
    method: 'POST',
    headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ id, pageType: 'related-playlists', userHash, headers: capturedHeaders }),
  });
  const raw = await response.text();
  let json = null; try { json = JSON.parse(raw); } catch {}
  return { status: response.status, raw: json ? null : raw.slice(0, 3000), json };
}, { capturedHeaders, id: TRACK_ID, userHash: USER_HASH });

console.log(JSON.stringify({ status: result.status, raw: result.raw, top_keys: result.json ? Object.keys(result.json) : [], matches: result.json ? walk(result.json) : [] }, null, 2));
await browser.close();
