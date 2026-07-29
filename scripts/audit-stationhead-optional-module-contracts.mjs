import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pages = [
  'https://www.stationhead.com/sakuramankai',
  'https://www.stationhead.com/buddy46',
];
const knownAssets = [
  'https://www.stationhead.com/assets/launch-Cnzf9rN1.js',
  'https://www.stationhead.com/assets/SelectedGIF-BaAx9j6X.js',
  'https://www.stationhead.com/assets/Tooltip-CXAFiWY6.js',
  'https://www.stationhead.com/assets/LottieAnimationViewNonLazy-VE60c2nO.js',
];
const targetPattern = /^(selectedgif|tooltip|lottieanimationviewnonlazy)-/i;
const assetPattern = /(?:https:\/\/www\.stationhead\.com)?\/?assets\/[A-Za-z0-9_.$-]+\.m?js/g;

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'HomePanel Stationhead module contract audit' },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function normalizeAsset(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:') return '';
    if (url.hostname !== 'stationhead.com' && url.hostname !== 'www.stationhead.com') return '';
    if (!url.pathname.startsWith('/assets/') || !/\.m?js$/i.test(url.pathname)) return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function assetsIn(source, base) {
  const assets = new Set();
  for (const match of source.matchAll(assetPattern)) {
    const normalized = normalizeAsset(match[0], base);
    if (normalized) assets.add(normalized);
  }
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+\.m?js(?:\?[^"']*)?)["']/gi)) {
    const normalized = normalizeAsset(match[1], base);
    if (normalized) assets.add(normalized);
  }
  return assets;
}

function exportNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of match[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/)?.[1];
      const local = part.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (alias || local) names.add(alias || local);
    }
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  if (/export\s+default\b/.test(source)) names.add('default');
  return [...names].sort();
}

function compactSnippet(source, at, length) {
  const start = Math.max(0, at - 220);
  const end = Math.min(source.length, at + length + 320);
  return source.slice(start, end).replace(/\s+/g, ' ').slice(0, 800);
}

async function main() {
  const sources = new Map();
  const queue = [...knownAssets];
  for (const page of pages) {
    const html = await fetchText(page);
    for (const asset of assetsIn(html, page)) queue.push(asset);
  }

  while (queue.length && sources.size < 250) {
    const url = queue.shift();
    if (!url || sources.has(url)) continue;
    try {
      const source = await fetchText(url);
      sources.set(url, source);
      for (const asset of assetsIn(source, url)) {
        if (!sources.has(asset)) queue.push(asset);
      }
    } catch (error) {
      console.error(String(error));
      sources.set(url, '');
    }
  }

  const modules = [];
  for (const [url, source] of sources) {
    const basename = new URL(url).pathname.split('/').pop() || '';
    if (!targetPattern.test(basename)) continue;
    const importers = [];
    for (const [importerUrl, importerSource] of sources) {
      if (importerUrl === url || !importerSource) continue;
      let at = importerSource.indexOf(basename);
      while (at >= 0 && importers.length < 20) {
        importers.push({
          url: importerUrl,
          snippet: compactSnippet(importerSource, at, basename.length),
        });
        at = importerSource.indexOf(basename, at + basename.length);
      }
    }
    modules.push({
      url,
      basename,
      bytes: Buffer.byteLength(source),
      exports: exportNames(source),
      importers,
    });
  }

  modules.sort((a, b) => a.basename.localeCompare(b.basename));
  const outDir = '.sh-module-contract-audit';
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'contracts.json'), `${JSON.stringify({ pages, modules }, null, 2)}\n`);
  const lines = [
    '# Stationhead optional module contracts',
    '',
    ...modules.flatMap((module) => [
      `## ${module.basename}`,
      `- Bytes: ${module.bytes}`,
      `- Exports: ${module.exports.length ? module.exports.join(', ') : '(none detected)'}`,
      `- Importers: ${module.importers.length}`,
      ...module.importers.map((importer) => `  - ${new URL(importer.url).pathname.split('/').pop()}: ${importer.snippet}`),
      '',
    ]),
  ];
  await writeFile(path.join(outDir, 'contracts.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (!modules.some((module) => /^SelectedGIF-/i.test(module.basename) && module.exports.length)) {
    throw new Error('SelectedGIF export contract not discovered');
  }
  if (!modules.some((module) => /^Tooltip-/i.test(module.basename) && module.exports.length)) {
    throw new Error('Tooltip export contract not discovered');
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
