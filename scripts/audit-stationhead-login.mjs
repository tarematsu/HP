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
  node.innerText || '',
  node.textContent || '',
  node.getAttribute('aria-label') || '',
  node.getAttribute('title') || '',
  node.getAttribute('value') || '',
].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');

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
  const candidates = page.locator(
    'button, [role="button"], a, input[type="button"], input[type="submit"]',
  );
  const count = Math.min(await candidates.count(), 250);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    if (pattern.test(await labelOf(candidate))) return candidate;
  }
  return null;
}

async function capturePhase(page, name) {
  return page.evaluate((phaseName) => {
    const compact = (value, limit = 240) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
    const visible = (element) => {
      if (!element || element.getAttribute?.('aria-hidden') === 'true') return false;
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 2 || rect.height <= 2) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0;
    };
    const safeHref = (element) => {
      const raw = element.getAttribute?.('href') || '';
      if (!raw) return '';
      try {
        const url = new URL(raw, location.href);
        return `${url.origin}${url.pathname}`.slice(0, 300);
      } catch {
        return compact(raw, 300);
      }
    };
    const selector = [
      'button',
      '[role="button"]',
      'a',
      'input',
      'select',
      'textarea',
      '[role="dialog"]',
      '[role="alertdialog"]',
      'h1',
      'h2',
      'h3',
      '[aria-label]',
    ].join(',');
    const elements = [];
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element)) continue;
      const tag = element.tagName.toLowerCase();
      const type = compact(element.getAttribute?.('type'), 80);
      const valueAllowed = tag === 'button' || type === 'button' || type === 'submit';
      const rect = element.getBoundingClientRect();
      elements.push({
        tag,
        role: compact(element.getAttribute?.('role'), 80),
        type,
        text: compact(element.innerText || element.textContent),
        ariaLabel: compact(element.getAttribute?.('aria-label')),
        title: compact(element.getAttribute?.('title')),
        placeholder: compact(element.getAttribute?.('placeholder')),
        autocomplete: compact(element.getAttribute?.('autocomplete'), 80),
        name: compact(element.getAttribute?.('name'), 120),
        id: compact(element.id, 120),
        className: compact(
          typeof element.className === 'string' ? element.className : '',
          180,
        ),
        testId: compact(element.getAttribute?.('data-testid'), 120),
        value: valueAllowed ? compact(element.getAttribute?.('value')) : '',
        href: safeHref(element),
        disabled: Boolean(element.disabled) ||
          element.getAttribute?.('aria-disabled') === 'true',
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
      if (elements.length >= 250) break;
    }
    return {
      name: phaseName,
      capturedAt: new Date().toISOString(),
      url: `${location.origin}${location.pathname}`,
      title: document.title,
      readyState: document.readyState,
      elements,
    };
  }, name);
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const outPath = path.resolve(option('--out', '.sh-js-audit/login-report.json'));
  await mkdir(path.dirname(outPath), { recursive: true });
  const emailValue = process.env.STATIONHEAD_EMAIL || '';
  const passwordValue = process.env.STATIONHEAD_PASSWORD || '';
  const report = {
    targetUrl,
    credentialsAvailable: Boolean(emailValue && passwordValue),
    startListeningVisible: false,
    startListeningClicked: false,
    musicModalCloseVisible: false,
    musicModalCloseClicked: false,
    loginControlVisible: false,
    loginControlClicked: false,
    loginOpenedPopup: false,
    emailInputVisible: false,
    passwordInputVisible: false,
    loginSubmitted: false,
    phases: [],
  };

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
    await page.waitForTimeout(1500);
    report.phases.push(await capturePhase(page, 'initial'));

    const start = await visibleLabelled(page, /start\s+listening/i);
    report.startListeningVisible = Boolean(start);
    if (start) {
      report.startListeningClicked = await start.click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (report.startListeningClicked) await page.waitForTimeout(2500);
    }
    report.phases.push(await capturePhase(page, 'after-start-listening'));

    const closeMusic = await visibleLabelled(page, /^(close|閉じる)$/i);
    report.musicModalCloseVisible = Boolean(closeMusic);
    if (closeMusic) {
      report.musicModalCloseClicked = await closeMusic.click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (report.musicModalCloseClicked) await page.waitForTimeout(1000);
    }
    report.phases.push(await capturePhase(page, 'after-connect-music-close'));

    const login = await visibleLabelled(
      page,
      /(?:^|\b)(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\b|$)/i,
    );
    report.loginControlVisible = Boolean(login);
    let loginPage = page;
    if (login) {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 })
        .catch(() => null);
      report.loginControlClicked = await login.click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      const popup = report.loginControlClicked ? await popupPromise : null;
      if (popup) {
        report.loginOpenedPopup = true;
        loginPage = popup;
        await popup.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => null);
      }
      if (report.loginControlClicked) await loginPage.waitForTimeout(2500);
    }
    report.phases.push(await capturePhase(loginPage, 'after-login-control'));

    const email = await visibleFirst(
      loginPage,
      'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]',
    );
    report.emailInputVisible = Boolean(email);
    if (email && report.credentialsAvailable) {
      await email.fill(emailValue).catch(() => null);
    }

    let password = await visibleFirst(
      loginPage,
      'input[type="password"], input[autocomplete="current-password"]',
    );
    if (!password && email && report.credentialsAvailable) {
      const next = await visibleLabelled(loginPage, /continue|next|続ける|次へ/i);
      if (next) await next.click({ timeout: 3000 }).catch(() => null);
      await loginPage.waitForTimeout(2000);
      report.phases.push(await capturePhase(loginPage, 'after-login-next'));
      password = await visibleFirst(
        loginPage,
        'input[type="password"], input[autocomplete="current-password"]',
      );
    }
    report.passwordInputVisible = Boolean(password);
    if (password && report.credentialsAvailable) {
      await password.fill(passwordValue).catch(() => null);
      const submit = await visibleLabelled(
        loginPage,
        /log\s*in|sign\s*in|login|continue|next|ログイン|続ける|次へ/i,
      );
      report.loginSubmitted = submit
        ? await submit.click({ timeout: 3000 }).then(() => true).catch(() => false)
        : await password.press('Enter').then(() => true).catch(() => false);
      if (report.loginSubmitted) await loginPage.waitForTimeout(3000);
      report.phases.push(await capturePhase(loginPage, 'after-login-submit'));
    }
    await context.close();
  } finally {
    await browser.close();
  }

  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    credentialsAvailable: report.credentialsAvailable,
    startListeningVisible: report.startListeningVisible,
    startListeningClicked: report.startListeningClicked,
    musicModalCloseVisible: report.musicModalCloseVisible,
    musicModalCloseClicked: report.musicModalCloseClicked,
    loginControlVisible: report.loginControlVisible,
    loginControlClicked: report.loginControlClicked,
    loginOpenedPopup: report.loginOpenedPopup,
    emailInputVisible: report.emailInputVisible,
    passwordInputVisible: report.passwordInputVisible,
    loginSubmitted: report.loginSubmitted,
    phaseCount: report.phases.length,
  }));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});