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

function stationheadAsset(url) {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === 'stationhead.com' || parsed.hostname.endsWith('.stationhead.com')) &&
      parsed.pathname.startsWith('/assets/') && /\.m?js$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function basename(url) {
  try { return new URL(url).pathname.split('/').pop() || ''; } catch { return ''; }
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
  if (/export\s+default\b/.test(source)) names.add('default');
  return [...names].sort();
}

function compactSnippet(source, at, length) {
  const start = Math.max(0, at - 180);
  const end = Math.min(source.length, at + length + 260);
  return source.slice(start, end).replace(/\s+/g, ' ').slice(0, 700);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'HomePanel Stationhead module audit' },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function reportScriptMap(report) {
  return new Map((report.baseline?.scripts || []).map((item) => [item.url, item]));
}

function candidateUrls(report) {
  const scriptMap = reportScriptMap(report);
  const explicit = [
    ...(report.classifiedBlocked || []),
    ...(report.likelyOptionalOpaque || []),
    ...(report.mixedOpaque || []),
  ];
  const boundedModules = [...scriptMap.values()].filter((item) => {
    const name = basename(item.url);
    if (!stationheadAsset(item.url)) return false;
    if (/^(?:launch-|index-|StationView-)/i.test(name)) return false;
    return Number(item.decodedBytes || 0) <= 180_000;
  });
  return [...new Set([...explicit, ...boundedModules]
    .map((item) => item.url)
    .filter(stationheadAsset))];
}

function safeFilename(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

async function main() {
  const reportPath = option('--report');
  const outPath = option('--out', 'module-graph.json');
  if (!reportPath) throw new Error('--report is required');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const scriptMap = reportScriptMap(report);
  const scripts = [...new Set((report.baseline?.scripts || [])
    .map((item) => item.url)
    .filter(stationheadAsset))];
  const sources = new Map();
  for (const url of scripts) {
    try {
      sources.set(url, await fetchText(url));
    } catch (error) {
      sources.set(url, '');
      console.error(String(error));
    }
  }

  const outputDirectory = path.dirname(path.resolve(outPath));
  const sourceDirectory = path.join(outputDirectory, 'module-sources');
  await mkdir(sourceDirectory, { recursive: true });

  const modules = [];
  for (const url of candidateUrls(report)) {
    const name = basename(url);
    const source = sources.get(url) || '';
    const bytes = Buffer.byteLength(source);
    const reportEntry = scriptMap.get(url) || {};
    const importers = [];
    for (const [importerUrl, importerSource] of sources) {
      if (importerUrl === url || !importerSource) continue;
      let at = importerSource.indexOf(name);
      while (at >= 0 && importers.length < 16) {
        importers.push({
          url: importerUrl,
          snippet: compactSnippet(importerSource, at, name.length),
        });
        at = importerSource.indexOf(name, at + name.length);
      }
    }
    const sourceFile = source ? `module-sources/${safeFilename(name)}` : '';
    if (sourceFile) {
      await writeFile(path.join(outputDirectory, sourceFile), source);
    }
    modules.push({
      url,
      basename: name,
      bytes,
      encodedBytes: Number(reportEntry.encodedBytes || 0),
      decodedBytes: Number(reportEntry.decodedBytes || bytes),
      classification: reportEntry.classification || null,
      optionalSignals: reportEntry.optionalSignals || [],
      protectedSignals: reportEntry.protectedSignals || [],
      exports: exportNames(source),
      sourceFile,
      source: bytes > 0 && bytes <= 4096 ? source : '',
      importers,
    });
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ reportPath, modules }, null, 2)}\n`);
  const lines = [
    '# Stationhead module contracts',
    '',
    `- Candidate modules: ${modules.length}`,
    `- Candidate decoded bytes: ${modules.reduce((total, module) => total + module.decodedBytes, 0)}`,
    '',
    ...modules.flatMap((module) => [
      `## ${module.basename}`,
      `- Bytes: ${module.bytes}`,
      `- Encoded bytes: ${module.encodedBytes}`,
      `- Exports: ${module.exports.length ? module.exports.join(', ') : '(none detected)'}`,
      `- Optional signals: ${module.optionalSignals.length ? module.optionalSignals.join(', ') : '(none)'}`,
      `- Protected signals: ${module.protectedSignals.length ? module.protectedSignals.join(', ') : '(none)'}`,
      `- Importers: ${module.importers.length}`,
      `- Source artifact: ${module.sourceFile || '(fetch failed)'}`,
      ...module.importers.map((importer) => `  - ${basename(importer.url)}: ${importer.snippet}`),
      ...(module.source ? ['- Source:', '```js', module.source, '```'] : []),
      '',
    ]),
  ];
  const markdownPath = outPath.replace(/\.json$/i, '.md');
  await writeFile(markdownPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
