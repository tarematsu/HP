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
  const start = Math.max(0, at - 140);
  const end = Math.min(source.length, at + length + 180);
  return source.slice(start, end).replace(/\s+/g, ' ').slice(0, 500);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'HomePanel Stationhead module audit' },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function main() {
  const reportPath = option('--report');
  const outPath = option('--out', 'module-graph.json');
  if (!reportPath) throw new Error('--report is required');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const scripts = [...new Set(report.baseline.scripts.map((item) => item.url).filter(stationheadAsset))];
  const sources = new Map();
  for (const url of scripts) {
    try {
      sources.set(url, await fetchText(url));
    } catch (error) {
      sources.set(url, '');
      console.error(String(error));
    }
  }

  const targets = report.classifiedBlocked
    .map((item) => item.url)
    .filter(stationheadAsset);
  const modules = [];
  for (const url of targets) {
    const name = basename(url);
    const source = sources.get(url) || '';
    const importers = [];
    for (const [importerUrl, importerSource] of sources) {
      if (importerUrl === url || !importerSource) continue;
      let at = importerSource.indexOf(name);
      while (at >= 0 && importers.length < 12) {
        importers.push({
          url: importerUrl,
          snippet: compactSnippet(importerSource, at, name.length),
        });
        at = importerSource.indexOf(name, at + name.length);
      }
    }
    modules.push({
      url,
      basename: name,
      bytes: Buffer.byteLength(source),
      exports: exportNames(source),
      importers,
    });
  }

  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ reportPath, modules }, null, 2)}\n`);
  const lines = [
    '# Stationhead blocked-module contracts',
    '',
    ...modules.flatMap((module) => [
      `## ${module.basename}`,
      `- Exports: ${module.exports.length ? module.exports.join(', ') : '(none detected)'}`,
      `- Importers: ${module.importers.length}`,
      ...module.importers.map((importer) => `  - ${basename(importer.url)}: ${importer.snippet}`),
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
