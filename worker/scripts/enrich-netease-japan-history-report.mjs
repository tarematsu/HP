import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseNeteaseJapanJson, renderMarkdownReport } from './investigate-netease-japan-chart-history.mjs';

const USER_AGENT = 'Mozilla/5.0 compatible; skrzk-pages-history-enricher/1.0';

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

export function extractNeteasePreloadedSongs(html) {
  const source = String(html || '');
  const match = source.match(/<textarea\b[^>]*\bid=["']song-list-pre-data["'][^>]*>([\s\S]*?)<\/textarea>/i);
  if (!match) return [];
  const text = decodeHtmlEntities(match[1]).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function structuredMatchesFromArchivedHtml(html) {
  const tracks = extractNeteasePreloadedSongs(html);
  if (!tracks.length) return [];
  return parseNeteaseJapanJson({ playlist: { id: 60131, name: '日本Oricon榜', tracks } }).matches;
}

async function fetchText(url, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html,*/*;q=0.8', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function countByArtist(matches) {
  const counts = { sakurazaka46: 0, nogizaka46: 0, hinatazaka46: 0 };
  for (const match of matches) counts[match.canonical_artist] = (counts[match.canonical_artist] || 0) + 1;
  return counts;
}

function dedupe(matches) {
  const seen = new Set();
  const output = [];
  for (const match of matches) {
    const key = [match.iso_week, match.canonical_artist, match.position ?? '', match.track_id ?? '', match.title ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(match);
  }
  return output.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || (a.position ?? 9999) - (b.position ?? 9999));
}

export async function enrichHistoricalMatches(report, fetchHtml = fetchText) {
  const previousMatches = Array.isArray(report?.archive?.matches) ? report.archive.matches : [];
  const groups = new Map();
  for (const match of previousMatches) {
    const key = `${match.timestamp}|${match.archive_url}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  const enriched = [];
  const failures = [];
  for (const [key, fallbackMatches] of groups) {
    const sample = fallbackMatches[0];
    try {
      const html = await fetchHtml(sample.archive_url);
      const structured = structuredMatchesFromArchivedHtml(html);
      if (!structured.length) {
        enriched.push(...fallbackMatches);
        failures.push({ timestamp: sample.timestamp, archive_url: sample.archive_url, error: 'song-list-pre-data contained no Sakamichi rows' });
        continue;
      }
      for (const match of structured) {
        enriched.push({
          timestamp: sample.timestamp,
          iso_week: sample.iso_week,
          archive_url: sample.archive_url,
          original_url: sample.original_url,
          format: 'html+song-list-pre-data',
          ...match,
          rank_source: 'song-list-pre-data array order',
        });
      }
    } catch (error) {
      enriched.push(...fallbackMatches);
      failures.push({ timestamp: sample.timestamp, archive_url: sample.archive_url, error: String(error?.message || error) });
    }
  }

  const matches = dedupe(enriched);
  return {
    ...report,
    archive: {
      ...report.archive,
      counts: countByArtist(matches),
      matches,
      enrichment: {
        attempted_snapshots: groups.size,
        exact_snapshots: groups.size - failures.length,
        fallback_snapshots: failures.length,
        failures,
      },
    },
  };
}

async function main() {
  const input = process.argv[2] || 'netease-japan-history-result.json';
  const markdown = process.argv[3] || 'netease-japan-history-result.md';
  const report = JSON.parse(await readFile(input, 'utf8'));
  const enriched = await enrichHistoricalMatches(report);
  await writeFile(input, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');
  await writeFile(markdown, renderMarkdownReport(enriched), 'utf8');
  console.log(JSON.stringify({
    event: 'netease_japan_history_enriched',
    matches: enriched.archive.matches.length,
    counts: enriched.archive.counts,
    enrichment: enriched.archive.enrichment,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
