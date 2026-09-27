import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const target = 'tokyosnow';
const output = process.env.PROBE_OUTPUT || 'stationhead-user-streams.json';
const pageUrl = 'https://www.stationhead.com/c/buddies';
const metricKey = /stream|listen|play|active.?day/i;
const identityKey = /^(user(name)?|handle|screen_name|display_name|name)$/i;

function scan(value, result, path = '$', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 14 || result.visited++ > 20_000) return;
  if (Array.isArray(value)) {
    value.slice(0, 1000).forEach((item, index) => scan(item, result, `${path}[${index}]`, depth + 1));
    return;
  }
  const entries = Object.entries(value);
  const matches = entries.some(([key, item]) => identityKey.test(key) && typeof item === 'string' && item.toLowerCase() === target);
  if (matches) {
    result.matches.push({
      path,
      keys: entries.map(([key]) => key).slice(0, 60),
      metrics: entries.flatMap(([key, item]) => {
        if (metricKey.test(key) && typeof item === 'number') return [{ key, value: item }];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return Object.entries(item).filter(([nestedKey, number]) => metricKey.test(nestedKey) && typeof number === 'number')
            .map(([nestedKey, number]) => ({ key: `${key}.${nestedKey}`, value: number }));
        }
        return [];
      }).slice(0, 30),
    });
  }
  for (const [key, item] of entries) scan(item, result, `${path}.${key}`, depth + 1);
}

const report = { target, page: pageUrl, observed_at: new Date().toISOString(), steps: [], responses: [], errors: [] };
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  const pending = [];
  page.on('response', (response) => {
    const task = (async () => {
      const url = new URL(response.url());
      if (url.hostname !== 'stationhead.com' && !url.hostname.endsWith('.stationhead.com')) return;
      if (!/json/i.test(response.headers()['content-type'] || '')) return;
      const body = await response.json();
      const result = { visited: 0, matches: [] };
      scan(body, result);
      report.responses.push({
        host: url.hostname,
        path: url.pathname,
        status: response.status(),
        top_level_keys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 40) : [],
        target_matches: result.matches.slice(0, 20),
      });
    })().catch((error) => report.errors.push(`response inspection: ${error.message}`));
    pending.push(task);
  });

  await page.goto(`https://www.stationhead.com/${target}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  report.steps.push('opened public profile without clicking');
  await page.waitForTimeout(3000);
  report.target_visible = await page.getByRole('img', { name: target }).isVisible().catch(() => false);
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  report.steps.push('opened Buddies landing page without clicking');
  await page.waitForTimeout(3000);
  await Promise.allSettled(pending);
} catch (error) {
  report.errors.push(`interaction: ${error.message}`);
} finally {
  await browser.close();
  // Response bodies, headers, cookies, query strings and screenshots are never saved.
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify({ steps: report.steps, responses: report.responses.length, target_matches: report.responses.reduce((n, item) => n + item.target_matches.length, 0), errors: report.errors }));
if (!report.target_visible) process.exitCode = 1;
