import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const option = (name, fallback = '') => {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
    ? process.argv[at + 1]
    : fallback;
};
const flag = (name) => process.argv.includes(name);
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const safeName = (value) => String(value || '')
  .replace(/^https?:\/\//i, '')
  .replace(/[^A-Za-z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 100) || 'stationhead';
const startPattern = /start\s+listening|listen\s+(?:now|live)|join\s+(?:station|room)|resume|continue|再生|聴く|参加/i;

function extractWideArray(source, name, required = true) {
  const match = source.match(new RegExp(
    `(?:inline\\s+)?constexpr\\s+std::wstring_view\\s+${name}\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`,
  ));
  if (!match) {
    if (required) throw new Error(`Could not find ${name} in native policy`);
    return [];
  }
  return [...match[1].matchAll(/L"([^"]+)"/g)].map((entry) => entry[1].toLowerCase());
}

function extractNarrowString(source, name) {
  const declaration = source.match(new RegExp(
    `inline\\s+constexpr\\s+std::string_view\\s+${name}\\s*=\\s*((?:"(?:\\\\.|[^"\\\\])*"\\s*)+);`,
  ));
  if (!declaration) throw new Error(`Could not find ${name} in native policy`);
  const parts = [...declaration[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((entry) => JSON.parse(`"${entry[1]}"`));
  if (!parts.length) throw new Error(`Could not decode ${name} in native policy`);
  return parts.join('');
}

function extractModuleStubs(source) {
  const result = [];
  const matcher = /if\s*\(\s*StationheadHashedAssetModulePathMatches\(\s*uri\.path\s*,\s*L"([^"]+)"\s*\)\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*);/g;
  for (const match of source.matchAll(matcher)) {
    result.push({ stem: match[1].toLowerCase(), body: extractNarrowString(source, match[2]) });
  }
  if (!result.length) throw new Error('Could not find module stub mappings in native policy');
  return result;
}

function parseUrl(value) {
  try {
    const parsed = new URL(value);
    return {
      valid: parsed.protocol === 'https:' || parsed.protocol === 'http:',
      scheme: parsed.protocol.slice(0, -1).toLowerCase(),
      host: parsed.hostname.toLowerCase(),
      path: parsed.pathname.toLowerCase(),
    };
  } catch {
    return { valid: false, scheme: '', host: '', path: '' };
  }
}
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const hashedAssetMatches = (assetPath, stem) => {
  if (!assetPath.startsWith('/assets/')) return false;
  const filename = assetPath.slice('/assets/'.length);
  if (!filename.startsWith(`${stem}-`)) return false;
  const extension = filename.endsWith('.mjs') ? '.mjs' : filename.endsWith('.js') ? '.js' : '';
  if (!extension) return false;
  const hash = filename.slice(stem.length + 1, -extension.length);
  return hash.length >= 6 && /^[a-z0-9_-]+$/.test(hash);
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const scanSignals = (text, tokens) => {
  const lower = String(text || '').toLowerCase();
  return tokens.filter((token) => lower.includes(token)).slice(0, 40);
};
const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
};

async function loadPolicy() {
  const scriptHeader = await readFile('hp/native/src/sh_runtime_script_resource_policy_fix.h', 'utf8');
  const boundaryHeader = await readFile('hp/native/src/sh_runtime_resource_boundary_policy_fix.h', 'utf8');
  return {
    scriptDomains: extractWideArray(scriptHeader, 'kNonPlaybackScriptDomains'),
    protectedTokens: extractWideArray(scriptHeader, 'kProtectedScriptNeedles', false),
    optionalTokens: extractWideArray(scriptHeader, 'kNonPlaybackScriptNeedles', false),
    moduleStubs: extractModuleStubs(scriptHeader),
    telemetryDomains: extractWideArray(boundaryHeader, 'kTelemetryDomains'),
  };
}

function classifyScript(url, policy) {
  const uri = parseUrl(url);
  const pass = { block: false, mode: 'pass', reason: 'outside-script-policy' };
  if (!uri.valid || uri.scheme !== 'https') return pass;
  for (const domain of policy.telemetryDomains) {
    if (hostMatches(uri.host, domain)) {
      return { block: true, mode: 'empty-classic', reason: `telemetry-domain:${domain}` };
    }
  }
  if (hostMatches(uri.host, 'connect.facebook.net') ||
      (hostMatches(uri.host, 'facebook.com') && uri.path.startsWith('/tr')) ||
      ((hostMatches(uri.host, 'twitter.com') || hostMatches(uri.host, 'x.com')) && uri.path.startsWith('/i/'))) {
    return { block: true, mode: 'empty-classic', reason: 'telemetry-social-pixel' };
  }
  for (const domain of policy.scriptDomains) {
    if (hostMatches(uri.host, domain)) {
      return { block: true, mode: 'empty-classic', reason: `optional-sdk-domain:${domain}` };
    }
  }
  if (!hostMatches(uri.host, 'stationhead.com')) return pass;
  for (const stub of policy.moduleStubs) {
    if (hashedAssetMatches(uri.path, stub.stem)) {
      return { block: true, mode: 'module-stub', reason: `known-module-stub:${stub.stem}`, body: stub.body };
    }
  }
  if (!uri.path.endsWith('.js') && !uri.path.endsWith('.mjs')) return pass;
  const protectedBy = policy.protectedTokens.filter((token) => uri.path.includes(token));
  return {
    block: false,
    mode: 'pass',
    reason: protectedBy.length ? 'protected-path-token' : 'unclassified-stationhead-script',
    protectedBy,
  };
}

async function candidateLabel(locator) {
  return locator.evaluate((node) => [
    node.textContent || '',
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.getAttribute('value') || '',
  ].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');
}

async function findPlaybackCandidate(page, timeoutMs = 15_000) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const candidates = page.locator('button, [role="button"], a, input[type="button"], input[type="submit"]');
    const count = Math.min(await candidates.count(), 300);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const label = await candidateLabel(candidate);
      if (startPattern.test(label)) return { candidate, label: label.slice(0, 160) };
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(400);
  } while (true);
  return null;
}

async function uiSnapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element || element.disabled || element.getAttribute?.('aria-hidden') === 'true') return false;
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 2 || rect.height <= 2) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const controls = [...document.querySelectorAll('button,[role="button"],a,input,select,textarea')]
      .filter(visible);
    const loginInputs = [...document.querySelectorAll('input')].filter((element) => {
      if (!visible(element)) return false;
      const type = String(element.type || '').toLowerCase();
      const name = `${element.name || ''} ${element.id || ''} ${element.placeholder || ''}`.toLowerCase();
      return type === 'password' || type === 'email' || /email|user|login|password/.test(name);
    });
    return {
      url: location.href,
      title: document.title,
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1600),
      interactiveCount: controls.length,
      loginSurfaceVisible: loginInputs.length > 0 || /log\s*in|sign\s*in|login|メール|パスワード/i.test(document.body?.innerText || ''),
    };
  }).catch(() => ({ url: '', title: '', bodyText: '', interactiveCount: 0, loginSurfaceVisible: false }));
}

async function attemptCredentialLogin(page, credentials) {
  const result = {
    credentialsAvailable: Boolean(credentials.email && credentials.password),
    loginAttempted: false,
    loginSubmitted: false,
    loginFormStillVisible: false,
  };
  if (!result.credentialsAvailable) return result;

  const email = page.locator('input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]').first();
  const password = page.locator('input[type="password"], input[autocomplete="current-password"]').first();
  const emailVisible = await email.isVisible().catch(() => false);
  const passwordVisible = await password.isVisible().catch(() => false);
  if (!emailVisible || !passwordVisible) return result;

  result.loginAttempted = true;
  await email.fill(credentials.email).catch(() => null);
  await password.fill(credentials.password).catch(() => null);
  const submit = page.locator('button[type="submit"], input[type="submit"], button').filter({
    hasText: /log\s*in|sign\s*in|login|continue|ログイン|続ける/i,
  }).first();
  result.loginSubmitted = await submit.click({ timeout: 3000 }).then(() => true).catch(async () => {
    return password.press('Enter').then(() => true).catch(() => false);
  });
  if (result.loginSubmitted) await page.waitForTimeout(4000);
  result.loginFormStillVisible = await password.isVisible().catch(() => false);
  return result;
}

async function runCapture({ browser, targetUrl, durationMs, policy, intercept, outDir, captureName, credentials }) {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const pending = new Map();
  const scripts = [];
  const intercepted = [];
  const consoleErrors = [];
  const pageErrors = [];
  const bodyTasks = [];
  const bodyByUrl = new Map();

  if (intercept) {
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'script') return route.continue();
      const classification = classifyScript(request.url(), policy);
      if (!classification.block) return route.continue();
      intercepted.push({ url: request.url(), mode: classification.mode, reason: classification.reason });
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        body: classification.body || '',
      });
    });
  }

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message || error).slice(0, 2000)));
  page.on('response', (response) => {
    if (intercept || response.request().resourceType() !== 'script') return;
    bodyTasks.push(response.body().then((body) => {
      const text = body.toString('utf8');
      bodyByUrl.set(response.url(), {
        decodedBytes: body.length,
        sha256: sha256(body),
        optionalSignals: scanSignals(text, policy.optionalTokens),
        protectedSignals: scanSignals(text, policy.protectedTokens),
      });
    }).catch(() => null));
  });
  cdp.on('Network.requestWillBeSent', (event) => {
    if (event.type === 'Script') pending.set(event.requestId, { url: event.request.url });
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = pending.get(event.requestId);
    if (request) Object.assign(request, { status: event.response.status, mimeType: event.response.mimeType });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = pending.get(event.requestId);
    if (!request) return;
    request.encodedBytes = event.encodedDataLength || 0;
    request.classification = classifyScript(request.url, policy);
    scripts.push(request);
    pending.delete(event.requestId);
  });
  cdp.on('Network.loadingFailed', (event) => {
    const request = pending.get(event.requestId);
    if (!request) return;
    Object.assign(request, {
      failed: true,
      errorText: event.errorText || '',
      encodedBytes: 0,
      classification: classifyScript(request.url, policy),
    });
    scripts.push(request);
    pending.delete(event.requestId);
  });

  let navigationError = '';
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    .catch((error) => { navigationError = String(error.message || error); });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);

  const ui = {
    startListeningVisible: false,
    startListeningLabel: '',
    clicked: false,
    afterClickScreenVisible: false,
    transitionSignals: [],
    before: await uiSnapshot(page),
    after: null,
    credentialsAvailable: Boolean(credentials.email && credentials.password),
    loginAttempted: false,
    loginSubmitted: false,
    loginFormStillVisible: false,
  };

  if (flag('--auto-click')) {
    const playback = await findPlaybackCandidate(page);
    ui.startListeningVisible = Boolean(playback);
    ui.startListeningLabel = playback?.label || '';
    await page.screenshot({ path: path.join(outDir, `${captureName}-before-click.png`), fullPage: true }).catch(() => null);
    if (playback) {
      ui.clicked = await playback.candidate.click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (ui.clicked) await page.waitForTimeout(5000);
    }
    ui.after = await uiSnapshot(page);
    const stillVisible = Boolean(await findPlaybackCandidate(page, 0));
    if (!stillVisible) ui.transitionSignals.push('start-control-disappeared');
    if (ui.before.url !== ui.after.url) ui.transitionSignals.push('url-changed');
    if (normalizeText(ui.before.bodyText) !== normalizeText(ui.after.bodyText)) ui.transitionSignals.push('body-changed');
    if (ui.after.loginSurfaceVisible) ui.transitionSignals.push('login-surface-visible');
    if (ui.after.interactiveCount > 0) ui.transitionSignals.push('interactive-screen-visible');
    ui.afterClickScreenVisible = Boolean(
      ui.clicked &&
      ui.after.bodyText &&
      ui.transitionSignals.length > 0,
    );
    await page.screenshot({ path: path.join(outDir, `${captureName}-after-click.png`), fullPage: true }).catch(() => null);

    if (intercept) Object.assign(ui, await attemptCredentialLogin(page, credentials));
  } else {
    ui.after = ui.before;
  }

  await page.waitForTimeout(durationMs);
  await Promise.allSettled(bodyTasks);
  // Keep stored UI text from the pre-credential post-click snapshot so secrets
  // can never be copied into reports or artifacts.
  const finalState = ui.after || ui.before;
  for (const script of scripts) Object.assign(script, bodyByUrl.get(script.url) || {});
  await context.close();
  return {
    finalState,
    navigationError,
    clicked: ui.clicked ? ui.startListeningLabel : '',
    ui,
    scripts,
    intercepted,
    consoleErrors,
    pageErrors,
  };
}

function summarize(targetUrl, baseline, blocked) {
  const unique = [...new Map(baseline.scripts.map((item) => [item.url, item])).values()];
  const classifiedBlocked = unique.filter((item) => item.classification?.block);
  const unclassified = unique.filter((item) => item.classification?.reason === 'unclassified-stationhead-script');
  const likelyOptionalOpaque = unclassified.filter((item) => item.optionalSignals?.length && !item.protectedSignals?.length);
  const mixedOpaque = unclassified.filter((item) => item.optionalSignals?.length && item.protectedSignals?.length);
  const expected = new Set(classifiedBlocked.map((item) => item.url));
  const intercepted = new Set(blocked.intercepted.map((item) => item.url));
  const missedInterceptions = [...expected].filter((url) => !intercepted.has(url));
  const passed = Boolean(
    !missedInterceptions.length &&
    blocked.pageErrors.length <= baseline.pageErrors.length &&
    blocked.finalState.bodyText &&
    blocked.ui.startListeningVisible &&
    blocked.ui.clicked &&
    blocked.ui.afterClickScreenVisible,
  );
  return {
    passed,
    targetUrl,
    baselineFinalUrl: baseline.finalState.url,
    blockedFinalUrl: blocked.finalState.url,
    baselineUniqueScripts: unique.length,
    baselineEncodedBytes: unique.reduce((sum, item) => sum + (item.encodedBytes || 0), 0),
    classifiedBlockedScripts: classifiedBlocked.length,
    classifiedBlockedEncodedBytes: classifiedBlocked.reduce((sum, item) => sum + (item.encodedBytes || 0), 0),
    interceptedRequests: blocked.intercepted.length,
    missedInterceptions,
    unclassifiedStationheadScripts: unclassified.length,
    likelyOptionalOpaque,
    mixedOpaque,
    classifiedBlocked: classifiedBlocked.sort((a, b) => (b.encodedBytes || 0) - (a.encodedBytes || 0)),
    baseline,
    blocked,
  };
}

function markdown(report) {
  const percent = report.baselineEncodedBytes
    ? (report.classifiedBlockedEncodedBytes / report.baselineEncodedBytes * 100).toFixed(1)
    : '0.0';
  return `${[
    '# Stationhead live JavaScript and UI audit',
    '',
    `- Target: ${report.targetUrl}`,
    `- Result: ${report.passed ? 'PASS' : 'FAIL'}`,
    `- Baseline unique scripts: ${report.baselineUniqueScripts}`,
    `- Baseline encoded script bytes: ${formatBytes(report.baselineEncodedBytes)}`,
    `- Pre-load replacements: ${report.classifiedBlockedScripts} scripts / ${formatBytes(report.classifiedBlockedEncodedBytes)} (${percent}%)`,
    `- Requests intercepted: ${report.interceptedRequests}`,
    `- Interception misses: ${report.missedInterceptions.length}`,
    `- Replaced-run Start Listening visible: ${report.blocked.ui.startListeningVisible}`,
    `- Replaced-run Start Listening clicked: ${report.blocked.ui.clicked}`,
    `- Replaced-run post-click screen visible: ${report.blocked.ui.afterClickScreenVisible}`,
    `- Transition signals: ${report.blocked.ui.transitionSignals.join(', ') || 'none'}`,
    `- Credentials available: ${report.blocked.ui.credentialsAvailable}`,
    `- Login attempted: ${report.blocked.ui.loginAttempted}`,
    `- Login submitted: ${report.blocked.ui.loginSubmitted}`,
    `- Baseline page errors: ${report.baseline.pageErrors.length}`,
    `- Replaced-run page errors: ${report.blocked.pageErrors.length}`,
    '- Audio playback: not evaluated',
    '',
    '## Replaced scripts',
    ...report.classifiedBlocked.map((item) =>
      `- ${formatBytes(item.encodedBytes)} — ${item.url} — ${item.classification.reason}`),
    '',
    '## Interception misses',
    ...(report.missedInterceptions.length ? report.missedInterceptions.map((url) => `- ${url}`) : ['- none']),
  ].join('\n')}\n`;
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const durationMs = Math.max(1000, Number(option('--duration-ms', '20000')) || 20000);
  const outDir = path.resolve(option('--out', path.join('.sh-js-audit', safeName(targetUrl))));
  await mkdir(outDir, { recursive: true });
  const policy = await loadPolicy();
  const credentials = {
    email: process.env.STATIONHEAD_EMAIL || '',
    password: process.env.STATIONHEAD_PASSWORD || '',
  };
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const baseline = await runCapture({
      browser, targetUrl, durationMs, policy, intercept: false, outDir, captureName: 'baseline', credentials: { email: '', password: '' },
    });
    const blocked = await runCapture({
      browser, targetUrl, durationMs, policy, intercept: true, outDir, captureName: 'replaced', credentials,
    });
    const report = summarize(targetUrl, baseline, blocked);
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const summary = markdown(report);
    await writeFile(path.join(outDir, 'summary.md'), summary);
    console.log(summary);
    if (!report.passed) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
