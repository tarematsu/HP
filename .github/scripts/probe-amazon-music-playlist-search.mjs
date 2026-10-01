import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const TARGET_TRACK_ID = 'B0DJLRN1LF';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
let capturedHeaders = null;

function scan(value, path = '$', out = [], depth = 0) {
  if (depth > 22 || value == null || out.length >= 1000) return out;
  if (typeof value === 'string') {
    if (/playlist|プレイリスト|showCatalogPlaylist|TOKYO SNOW|B0DJLRN1LF/i.test(value)) {
      out.push({ path, value: value.slice(0, 4000) });
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/playlist|title|primaryText|secondaryText|deeplink|url/i.test(key)) {
        const rendered = typeof item === 'string' ? item : JSON.stringify(item);
        if (/playlist|プレイリスト|TOKYO SNOW|B0DJLRN1LF/i.test(rendered || '')) {
          out.push({ path: `${path}.${key}`, value: String(rendered).slice(0, 4000) });
        }
      }
      scan(item, `${path}.${key}`, out, depth + 1);
    }
  }
  return out;
}

page.on('request', (request) => {
  if (!request.url().endsWith('/api/showSearch')) return;
  try {
    const body = JSON.parse(request.postData() || '{}');
    if (body.headers) capturedHeaders = body.headers;
  } catch {}
});

await page.goto('https://music.amazon.co.jp/search/TOKYO%20SNOW%20%E6%AB%BB%E5%9D%8246', {
  waitUntil: 'domcontentloaded', timeout: 60000,
});
await page.waitForTimeout(5000);
if (!capturedHeaders) throw new Error('showSearch headers were not captured');

const result = await page.evaluate(async ({ capturedHeaders, trackId, userHash }) => {
  const response = await fetch('https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/displayCatalogTrack', {
    method: 'POST',
    headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ id: trackId, userHash, headers: capturedHeaders }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, raw: json ? null : text.slice(0, 3000) };
}, { capturedHeaders, trackId: TARGET_TRACK_ID, userHash: USER_HASH });

console.log(JSON.stringify({
  track_id: TARGET_TRACK_ID,
  status: result.status,
  raw: result.raw,
  matches: result.json ? scan(result.json) : [],
}, null, 2));

await browser.close();
