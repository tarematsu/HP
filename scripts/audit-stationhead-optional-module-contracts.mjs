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
const quotedAssetPattern = /["']((?:https:\/\/www\.stationhead\.com)?\/?assets\/[A-Za-z0-9_.$-]+\.m?js|\.\.?\/[A-Za-z0-9_.$-]+\.m?js)["']/g;

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
    let candidate = String(value || '');
    if (/^assets\//i.test(candidate)) candidate = `/${candidate}`;
    const url = new URL(candidate, base);
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
  for (const match of source.matchAll(quotedAssetPattern)) {
    const normalized = normalizeAsset(match[1], base);
    if (normalized) assets.add(normalized);
  }
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+\.m?js(?:\?[^"']*)?)["']/gi)) {
    const normalized = normalizeAsset(match[1], base);
    if (normalized) assets.add(normalized);
  }
  return assets;
}

function exportMap(source) {
  const entries = [];
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of match[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const aliased = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliased) entries.push({ local: aliased[1], exported: aliased[2] });
      else if (/^[A-Za-z_$][\w$]*$/.test(part)) entries.push({ local: part, exported: part });
    }
  }
  return entries;
}

function compactSnippet(source, at, length, radius = 260) {
  const start = Math.max(0, at - radius);
  const end = Math.min(source.length, at + length + radius);
  return source.slice(start, end).replace(/\s+/g, ' ').slice(0, radius * 2 + length);
}

function definitionSnippet(source, local) {
  const exportAt = source.lastIndexOf('export{');
  const beforeExport = exportAt >= 0 ? source.slice(0, exportAt) : source;
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${local.replaceAll('$', '\\$')}\\s*=`),
    new RegExp(`(?:function|class)\\s+${local.replaceAll('$', '\\$')}\\b`),
    new RegExp(`${local.replaceAll('$', '\\$')}\\s*=`),
  ];
  for (const pattern of patterns) {
    const matches = [...beforeExport.matchAll(new RegExp(pattern.source, 'g'))];
    const match = matches.at(-1);
    if (match) return compactSnippet(beforeExport, match.index, match[0].length, 360);
  }
  const at = beforeExport.lastIndexOf(local);
  return at >= 0 ? compactSnippet(beforeExport, at, local.length, 360) : '';
}

function importedBindings(source, basename) {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["'](?:\\.\\/)?${escaped}["']`, 'g');
  const bindings = [];
  for (const match of source.matchAll(pattern)) {
    for (const raw of match[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const aliased = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const exported = aliased?.[1] || part;
      const local = aliased?.[2] || part;
      if (!/^[A-Za-z_$][\w$]*$/.test(exported) || !/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      const usagePattern = new RegExp(`(^|[^A-Za-z0-9_$])${local.replaceAll('$', '\\$')}([^A-Za-z0-9_$]|$)`, 'g');
      const usages = [];
      usagePattern.lastIndex = match.index + match[0].length;
      let usage;
      while ((usage = usagePattern.exec(source)) && usages.length < 4) {
        const at = usage.index + usage[1].length;
        usages.push(compactSnippet(source, at, local.length, 300));
      }
      bindings.push({ exported, local, usages });
    }
  }
  return bindings;
}

async function main() {
  const sources = new Map();
  const queue = [...knownAssets];
  for (const page of pages) {
    const html = await fetchText(page);
    for (const asset of assetsIn(html, page)) queue.push(asset);
  }

  while (queue.length && sources.size < 400) {
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
    if (!targetPattern.test(basename) || !source) continue;
    const exports = exportMap(source);
    const importers = [];
    for (const [importerUrl, importerSource] of sources) {
      if (importerUrl === url || !importerSource) continue;
      const bindings = importedBindings(importerSource, basename);
      if (bindings.length) importers.push({ url: importerUrl, bindings });
    }
    modules.push({
      url,
      basename,
      bytes: Buffer.byteLength(source),
      exports: exports.map((entry) => ({
        ...entry,
        definition: definitionSnippet(source, entry.local),
      })),
      importers,
    });
  }

  modules.sort((a, b) => a.basename.localeCompare(b.basename));
  const outDir = '.sh-module-contract-audit';
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'contracts.json'), `${JSON.stringify({ pages, fetchedModules: sources.size, modules }, null, 2)}\n`);
  const lines = [
    '# Stationhead optional module contracts',
    '',
    `Fetched modules: ${sources.size}`,
    '',
    ...modules.flatMap((module) => [
      `## ${module.basename}`,
      `- Bytes: ${module.bytes}`,
      `- Exports: ${module.exports.map((entry) => entry.exported).join(', ') || '(none detected)'}`,
      ...module.exports.map((entry) => `  - ${entry.exported} <= ${entry.local}: ${entry.definition}`),
      `- Importers: ${module.importers.length}`,
      ...module.importers.flatMap((importer) => [
        `  - ${new URL(importer.url).pathname.split('/').pop()}`,
        ...importer.bindings.flatMap((binding) => [
          `    - ${binding.exported} as ${binding.local}`,
          ...binding.usages.map((usage) => `      - ${usage}`),
        ]),
      ]),
      '',
    ]),
  ];
  await writeFile(path.join(outDir, 'contracts.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  const selected = modules.find((module) => /^SelectedGIF-/i.test(module.basename));
  const tooltip = modules.find((module) => /^Tooltip-/i.test(module.basename));
  if (!selected?.exports.length) throw new Error('SelectedGIF export contract not discovered');
  if (!tooltip?.exports.length) throw new Error('Tooltip export contract not discovered');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
