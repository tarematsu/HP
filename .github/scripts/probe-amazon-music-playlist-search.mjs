import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const events = [];
const push = (value) => events.push(value);

function interesting(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /playlist|プレイリスト|showSearch|filter|entityType|mediaType/i.test(text || '');
}

function scan(value, path = '$', out = [], depth = 0) {
  if (depth > 15 || value == null || out.length >= 400) return out;
  if (typeof value === 'string') {
    if (interesting(value)) out.push({ path, value: value.slice(0, 4000) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (interesting(key)) out.push({ path: `${path}.${key}`, value: typeof item === 'string' ? item.slice(0, 4000) : item });
      scan(item, `${path}.${key}`, out, depth + 1);
    }
  }
  return out;
}

page.on('request', (request) => {
  const url = request.url();
  if (!/music\.a2z\.com\/api/i.test(url)) return;
  const postData = request.postData();
  if (/showSearch|playlist/i.test(url) || interesting(postData)) {
    push({ type: 'request', method: request.method(), url, postData });
  }
});

page.on('response', async (response) => {
  const url = response.url();
  if (!/music\.a2z\.com\/api/i.test(url) || !/showSearch|playlist/i.test(url)) return;
  try {
    const json = await response.json();
    push({ type: 'response', status: response.status(), url, interesting: scan(json) });
  } catch {}
});

for (const query of ['承認欲求 櫻坂46', 'TOKYO SNOW 櫻坂46']) {
  const url = `https://music.amazon.co.jp/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const controls = await page.locator('button, a, [role="button"], [role="tab"]').allTextContents();
  push({ type: 'controls', query, controls: controls.map((item) => item.trim()).filter(Boolean).filter((item) => /プレイリスト|playlist/i.test(item)) });
  const playlist = page.getByText(/^(プレイリスト|Playlists?)$/i).first();
  if (await playlist.count()) {
    try {
      await playlist.click({ timeout: 5000 });
      await page.waitForTimeout(5000);
      push({ type: 'clicked-playlist-filter', query, url: page.url() });
    } catch (error) {
      push({ type: 'playlist-click-error', query, error: String(error?.message || error) });
    }
  }
}

console.log(JSON.stringify(events, null, 2));
await browser.close();
