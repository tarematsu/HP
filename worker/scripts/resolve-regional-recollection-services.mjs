import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const KKBOX_RECOLLECTION_PATHS = new Set([
  'worker/src/cron-dispatcher-entry.js',
  'worker/src/scheduled-crons.js',
  'worker/src/regional-music-dispatch-plan.js',
  'worker/scripts/resolve-regional-recollection-services.mjs',
  '.github/workflows/recollect-regional-music-manual.yml',
]);
const YOUTUBE_RECOLLECTION_PATHS = new Set([
  'worker/src/regional-music-youtube-music.js',
  'worker/src/regional-music-service-entry.js',
]);

export function resolveRegionalRecollectionSelection({
  eventName,
  changedFiles = [],
  manualServices = '',
} = {}) {
  if (eventName === 'push') {
    const changed = new Set((changedFiles || []).map((value) => String(value)));
    const services = [];
    if ([...KKBOX_RECOLLECTION_PATHS].some((path) => changed.has(path))) services.push('kkbox');
    if ([...YOUTUBE_RECOLLECTION_PATHS].some((path) => changed.has(path))) services.push('youtube_music');
    // The workflow's push path filter is deliberately narrow. If a future
    // matching change is not yet classified, preserve the former safe fallback.
    if (!services.length) services.push('youtube_music');
    return {
      services: services.join(','),
      verifyYoutube: services.includes('youtube_music'),
    };
  }

  const services = [...new Set(String(manualServices || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))];
  return {
    services: services.join(','),
    // An empty manual selection means --all, which includes YouTube Music.
    verifyYoutube: services.length === 0 || services.includes('youtube_music'),
  };
}

function changedFilesForPush() {
  try {
    return execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) throw new Error('Push event changed files are unavailable');
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const commits = Array.isArray(event.commits) ? event.commits : [];
    return [...new Set([
      ...(event.head_commit?.added || []),
      ...(event.head_commit?.modified || []),
      ...(event.head_commit?.removed || []),
      ...commits.flatMap((commit) => [
        ...(commit.added || []),
        ...(commit.modified || []),
        ...(commit.removed || []),
      ]),
    ])];
  }
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
  const selection = resolveRegionalRecollectionSelection({
    eventName,
    changedFiles: eventName === 'push' ? changedFilesForPush() : [],
    manualServices: process.env.INPUT_SERVICES || '',
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is missing');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `services=${selection.services}\nverify_youtube=${selection.verifyYoutube}\n`,
  );
  console.log(JSON.stringify({ event: eventName, ...selection }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
