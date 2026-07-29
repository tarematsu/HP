import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function option(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function safeName(value) {
  return String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'stationhead';
}

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
  const match = source.match(new RegExp(
    `inline\\s+constexpr\\s+std::string_view\\s+${name}\\s*=([\\s\\S]*?);`,
  ));
  if (!match) throw new Error(`Could not find ${name} in native policy`);
  const parts = [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((entry) => JSON.parse(`"${entry[1]}"`));
  if (!parts.length) throw new Error(`Could not decode ${name} in native policy`);
  return parts.join('');
}

function extractModuleStubs(source) {
  const stubs = [];
  const pattern = /if\s*\(\s*StationheadHashedAssetModulePathMatches\(\s*uri\.path\s*,\s*L"([^"]+)"\s*\)\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*);/g;
  for (const match of source.matchAll(pattern)) {
    stubs.push({
      stem: match[1].toLowerCase(),
      constant: match[2],
      body: extractNarrowString(source, match[2]),
    });
  }
  if (!stubs.length) throw new Error('Could not find hash-independent module stubs in native policy');
  return stubs;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
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

function hashedAssetMatches(assetPath, stem) {
  const prefix = '/assets/';
  if (!assetPath.startsWith(prefix)) return false;
  const filename = assetPath.slice(prefix.length);
  if (!filename.startsWith(stem)) return false;
  const suffix = filename.slice(stem.length);
  if (!suffix.startsWith('-')) return false;
  const extension = suffix.endsWith('.mjs') ? '.mjs' : suffix.endsWith('.js') ? '.js' : '';
  if (!extension) return false;
  const hash = suffix.slice(1, -extension.length);
  return hash.length >= 6 && /^[a-z0-9_-]+$/.test(hash);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function scanSignals(text, tokens) {
  const lower = String(text || '').toLowerCase();
  return tokens.filter((token) => lower.includes(token)).slice(0, 40);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

async function loadPolicy() {
  const scriptHeader = await readFile(
    'hp/native/src/sh_runtime_script_resource_policy_fix.h',
    'utf8',
  );
  const boundaryHeader = await readFile(
    'hp/native/src/sh_runtime_resource_boundary_policy_fix.h',
    'utf8',
  );
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
  const allowed = { block: false, mode: 'pass', reason: 'outside-script-policy' };
  if (!uri.valid || uri.scheme !== 'https') return allowed;

  for (const domain of policy.telemetryDomains) {
    if (hostMatches(uri.host, domain)) {
      return { block: true, mode: 'empty-classic', reason: `telemetry-domain:${domain}` };
    }
  }
  if (hostMatches(uri.host, 'connect.facebook.net')) {
    return { block: true, mode: 'empty-classic', reason: 'telemetry-domain:connect.facebook.net' };
  }
  if (hostMatches(uri.host, 'facebook.com') && uri.path.startsWith('/tr')) {
    return { block: true, mode: 'empty-classic', reason: 'telemetry-path:facebook.com/tr' };
  }
  if ((hostMatches(uri.host, 'twitter.com') || hostMatches(uri.host, 'x.com')) &&
      uri.path.startsWith('/i/')) {
    return { block: true, mode: 'empty-classic', reason: 'telemetry-path:social-pixel' };
  }

  for (const domain of policy.scriptDomains) {
    if (hostMatches(uri.host, domain)) {
      return { block: true, mode: 'empty-classic', reason: `optional-sdk-domain:${domain}` };
    }
  }

  if (!hostMatches(uri.host, 'stationhead.com')) return allowed;
  for (const moduleStub of policy.moduleStubs) {
    if (hashedAssetMatches(uri.path, moduleStub.stem)) {
      return {
        block: true,
        mode: 'module-stub',
        reason: `known-module-stub:${moduleStub.stem}`,
        body: moduleStub.body,
      };
    }
  }

  if (!uri.path.endsWith('.js') && !uri.path.endsWith('.mjs')) return allowed;
  const protectedBy = policy.protectedTokens.filter((token) => uri.path.includes(token));
  return {
    block: false,
    mode: 'pass',
    reason: protectedBy.length ? 'protected-path-token' : 'unclassified-stationhead-script',
    protectedBy,
  };
}

async function clickPlaybackCandidate(page) {
  const candidates = page.locator('button, [role="button"], a');
  const count = Math.min(await candidates.count(), 250);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const label = await candidate.evaluate((node) => [
      node.textContent || '',
      node.getAttribute('aria-label') || '',
      node.getAttribute('title') || '',
    ].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');
    if (!/start listening|listen now|listen live|join station|join room|resume|continue|再生|聴く|参加/i.test(label)) {
      continue;
    }
    const clicked = await candidate.click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (clicked) return label.slice(0, 160);
  }
  return '';
}

async function runCapture({ browser, targetUrl, durationMs, policy, intercept }) {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  const requests = new Map();
  const scripts = [];
  const intercepted = [];
  const consoleErrors = [];
  const pageErrors = [];
  const bodyTasks = [];
  const bodyByUrl = new Map();

  if (intercept) {
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'script') {
        await route.continue();
        return;
      }
      const classification = classifyScript(request.url(), policy);
      if (!classification.block) {
        await route.continue();
        return;
      }
      intercepted.push({
        url: request.url(),
        mode: classification.mode,
        reason: classification.reason,
      });
      await route.fulfill({
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
    if (response.request().resourceType() !== 'script' || intercept) return;
    const task = response.body().then((body) => {
      const text = body.toString('utf8');
      bodyByUrl.set(response.url(), {
        decodedBytes: body.length,
        sha256: sha256(body),
        optionalSignals: scanSignals(text, policy.optionalTokens),
        protectedSignals: scanSignals(text, policy.protectedTokens),
      });
    }).catch(() => null);
    bodyTasks.push(task);
  });

  cdp.on('Network.requestWillBeSent', (event) => {
    if (event.type !== 'Script') return;
    requests.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      initiatorType: event.initiator?.type || '',
      startedAt: event.timestamp,
    });
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    Object.assign(request, {
      status: event.response.status,
      mimeType: event.response.mimeType,
      fromDiskCache: Boolean(event.response.fromDiskCache),
      fromServiceWorker: Boolean(event.response.fromServiceWorker),
    });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.encodedBytes = event.encodedDataLength || 0;
    request.classification = classifyScript(request.url, policy);
    scripts.push(request);
    requests.delete(event.requestId);
  });
  cdp.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.failed = true;
    request.errorText = event.errorText || '';
    request.encodedBytes = 0;
    request.classification = classifyScript(request.url, policy);
    scripts.push(request);
    requests.delete(event.requestId);
  });

  let navigationError = '';
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    .catch((error) => { navigationError = String(error.message || error); });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
  const clicked = flag('--auto-click') ? await clickPlaybackCandidate(page) : '';
  if (clicked) await page.waitForTimeout(5000);
  await page.waitForTimeout(durationMs);
  await Promise.allSettled(bodyTasks);

  const finalState = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    scriptElements: [...document.scripts].filter((script) => script.src).length,
  })).catch(() => ({ url: '', title: '', bodyText: '', scriptElements: 0 }));

  for (const script of scripts) {
    if (bodyByUrl.has(script.url)) Object.assign(script, bodyByUrl.get(script.url));
  }

  await context.close();
  return {
    finalState,
    navigationError,
    clicked,
    scripts,
    intercepted,
    consoleErrors,
    pageErrors,
  };
}

function summarize(targetUrl, baseline, blocked) {
  const uniqueBaseline = [...new Map(baseline.scripts.map((item) => [item.url, item])).values()];
  const classifiedBlocked = uniqueBaseline.filter((item) => item.classification?.block);
  const unclassifiedStationhead = uniqueBaseline.filter((item) =>
    item.classification?.reason === 'unclassified-stationhead-script');
  const likelyOptionalOpaque = unclassifiedStationhead.filter((item) =>
    item.optionalSignals?.length && !item.protectedSignals?.length);
  const mixedOpaque = unclassifiedStationhead.filter((item) =>
    item.optionalSignals?.length && item.protectedSignals?.length);
  const totalBytes = uniqueBaseline.reduce((sum, item) => sum + (item.encodedBytes || 0), 0);
  const blockedBytes = classifiedBlocked.reduce((sum, item) => sum + (item.encodedBytes || 0), 0);
  const interceptedUrls = new Set(blocked.intercepted.map((item) => item.url));
  const expectedUrls = new Set(classifiedBlocked.map((item) => item.url));
  const missedInterceptions = [...expectedUrls].filter((url) => !interceptedUrls.has(url));

  return {
    targetUrl,
    baselineFinalUrl: baseline.finalState.url,
    blockedFinalUrl: blocked.finalState.url,
    baselineScriptRequests: baseline.scripts.length,
    baselineUniqueScripts: uniqueBaseline.length,
    baselineEncodedBytes: totalBytes,
    classifiedBlockedScripts: classifiedBlocked.length,
    classifiedBlockedEncodedBytes: blockedBytes,
    interceptedRequests: blocked.intercepted.length,
    missedInterceptions,
    unclassifiedStationheadScripts: unclassifiedStationhead.length,
    likelyOptionalOpaque,
    mixedOpaque,
    classifiedBlocked: classifiedBlocked.sort((a, b) => (b.encodedBytes || 0) - (a.encodedBytes || 0)),
    baseline,
    blocked,
  };
}

function markdown(report) {
  const blockedPercent = report.baselineEncodedBytes > 0
    ? (report.classifiedBlockedEncodedBytes / report.baselineEncodedBytes * 100).toFixed(1)
    : '0.0';
  const lines = [
    '# Stationhead live JavaScript audit',
    '',
    `- Target: ${report.targetUrl}`,
    `- Final URL: ${report.baselineFinalUrl}`,
    `- Baseline unique scripts: ${report.baselineUniqueScripts}`,
    `- Baseline encoded script bytes: ${formatBytes(report.baselineEncodedBytes)}`,
    `- Classified for pre-load blocking: ${report.classifiedBlockedScripts} scripts / ${formatBytes(report.classifiedBlockedEncodedBytes)} (${blockedPercent}%)`,
    `- Requests intercepted in blocked run: ${report.interceptedRequests}`,
    `- Expected URLs not intercepted: ${report.missedInterceptions.length}`,
    `- Unclassified Stationhead scripts: ${report.unclassifiedStationheadScripts}`,
    `- Opaque candidates with optional-only body signals: ${report.likelyOptionalOpaque.length}`,
    `- Opaque mixed bundles (optional + protected signals): ${report.mixedOpaque.length}`,
    `- Baseline page errors: ${report.baseline.pageErrors.length}`,
    `- Blocked-run page errors: ${report.blocked.pageErrors.length}`,
    `- Baseline auto-click: ${report.baseline.clicked || 'none'}`,
    `- Blocked-run auto-click: ${report.blocked.clicked || 'none'}`,
    '',
    '## Largest currently blocked scripts',
    ...report.classifiedBlocked.slice(0, 20).map((item) =>
      `- ${formatBytes(item.encodedBytes)} — ${item.url} — ${item.classification.reason} (${item.classification.mode})`),
    '',
    '## Opaque optional-only candidates',
    ...report.likelyOptionalOpaque.slice(0, 20).map((item) =>
      `- ${formatBytes(item.encodedBytes)} — ${item.url} — signals: ${item.optionalSignals.join(', ')}`),
    '',
    '## Opaque mixed bundles (do not block as a whole)',
    ...report.mixedOpaque.slice(0, 20).map((item) =>
      `- ${formatBytes(item.encodedBytes)} — ${item.url} — optional: ${item.optionalSignals.join(', ')}; protected: ${item.protectedSignals.join(', ')}`),
    '',
    '## Interception misses',
    ...(report.missedInterceptions.length
      ? report.missedInterceptions.map((url) => `- ${url}`)
      : ['- none']),
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const durationMs = Math.max(1000, Number(option('--duration-ms', '20000')) || 20000);
  const outDir = path.resolve(option('--out', path.join('.sh-js-audit', safeName(targetUrl))));
  await mkdir(outDir, { recursive: true });

  const policy = await loadPolicy();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const baseline = await runCapture({ browser, targetUrl, durationMs, policy, intercept: false });
    const blocked = await runCapture({ browser, targetUrl, durationMs, policy, intercept: true });
    const report = summarize(targetUrl, baseline, blocked);
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const summary = markdown(report);
    await writeFile(path.join(outDir, 'summary.md'), summary);
    console.log(summary);
    if (report.missedInterceptions.length ||
        report.blocked.pageErrors.length > report.baseline.pageErrors.length ||
        !report.blocked.finalState.bodyText) {
      process.exitCode = 2;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
