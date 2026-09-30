import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const events = [];
const push = (value) => events.push(value);

page.on('request', (request) => {
  const url = request.url();
  if (!/music\.a2z\.com\/api|music\.amazon\.co\.jp\/search/i.test(url)) return;
  push({
    type: 'request',
    method: request.method(),
    url,
    postData: request.postData()?.slice(0, 16000) || null,
  });
});

page.on('response', async (response) => {
  const url = response.url();
  if (!/music\.a2z\.com\/api/i.test(url)) return;
  let body = null;
  try { body = (await response.text()).slice(0, 24000); } catch {}
  push({ type: 'response', status: response.status(), url, body });
});

for (const query of ['承認欲求 櫻坂46', 'TOKYO SNOW 櫻坂46']) {
  const url = `https://music.amazon.co.jp/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
}

console.log(JSON.stringify(events, null, 2));
await browser.close();
