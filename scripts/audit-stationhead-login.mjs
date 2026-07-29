import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const option = (name, fallback = '') => {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const labelOf = (locator) => locator.evaluate((node) => [
  node.textContent || '',
  node.getAttribute('aria-label') || '',
  node.getAttribute('title') || '',
  node.getAttribute('value') || '',
].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');

const stubs = new Map([
  ['tooltip', 'export const T=({children})=>children??null;'],
  ['lottieanimationviewnonlazy', 'export const LottieAnimationViewNonLazy=()=>null;'],
  ['selectedgif', "const n=()=>null,c=24,v={$$typeof:Symbol.for('react.forward_ref'),render:n,modalOptions:{}};export{v as A,c as C,v as E,v as G,v as P,v as S,v as T,v as a,v as b,n as c,v as d,v as e,n as f,v as g,n as h,n as u};"],
]);

function stubFor(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' ||
        (parsed.hostname !== 'stationhead.com' && parsed.hostname !== 'www.stationhead.com')) return '';
    const match = parsed.pathname.toLowerCase().match(/^\/assets\/([a-z0-9]+)-[a-z0-9_-]{6,}\.m?js$/);
    return match ? stubs.get(match[1]) || '' : '';
  } catch {
    return '';
  }
}

async function visibleFirst(page, selector, limit = 100) {
  const candidates = page.locator(selector);
  const count = Math.min(await candidates.count(), limit);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function visibleLabelled(page, pattern) {
  const candidates = page.locator('button, [role="button"], a, input[type="button"], input[type="submit"]');
  const count = Math.min(await candidates.count(), 200);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    if (pattern.test(await labelOf(candidate))) return candidate;
  }
  return null;
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const outPath = path.resolve(option('--out', '.sh-js-audit/login-report.json'));
  await mkdir(path.dirname(outPath), { recursive: true });
  const emailValue = process.env.STATIONHEAD_EMAIL || '';
  const passwordValue = process.env.STATIONHEAD_PASSWORD || '';
  const report = {
    credentialsAvailable: Boolean(emailValue && passwordValue),
    startListeningVisible: false,
    startListeningClicked: false,
    loginControlVisible: false,
    loginControlClicked: false,
    emailInputVisible: false,
    passwordInputVisible: false,
    loginSubmitted: false,
  };

  if (!report.credentialsAvailable) {
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('Stationhead audit credentials are unavailable.');
    return;
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'script') return route.continue();
      const body = stubFor(route.request().url());
      return body
        ? route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body })
        : route.continue();
    });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);

    const start = await visibleLabelled(page, /start\s+listening/i);
    report.startListeningVisible = Boolean(start);
    if (start) {
      report.startListeningClicked = await start.click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (report.startListeningClicked) await page.waitForTimeout(2500);
    }
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(500);

    const login = await visibleLabelled(page, /^(log\s*in|sign\s*in|login|ログイン)$/i);
    report.loginControlVisible = Boolean(login);
    if (login) {
      report.loginControlClicked = await login.click({ timeout: 5000, force: true }).then(() => true).catch(() => false);
      if (report.loginControlClicked) await page.waitForTimeout(2500);
    }

    const email = await visibleFirst(page, 'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]');
    report.emailInputVisible = Boolean(email);
    if (email) await email.fill(emailValue).catch(() => null);

    let password = await visibleFirst(page, 'input[type="password"], input[autocomplete="current-password"]');
    if (!password && email) {
      const next = await visibleLabelled(page, /continue|next|続ける|次へ/i);
      if (next) await next.click({ timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(2000);
      password = await visibleFirst(page, 'input[type="password"], input[autocomplete="current-password"]');
    }
    report.passwordInputVisible = Boolean(password);
    if (password) {
      await password.fill(passwordValue).catch(() => null);
      const submit = await visibleLabelled(page, /log\s*in|sign\s*in|login|continue|next|ログイン|続ける|次へ/i);
      report.loginSubmitted = submit
        ? await submit.click({ timeout: 3000 }).then(() => true).catch(() => false)
        : await password.press('Enter').then(() => true).catch(() => false);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
