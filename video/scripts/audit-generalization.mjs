import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'public', 'scripts', 'examples', 'docs', 'test'];
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.json', '.jsonc', '.md', '.html', '.css', '.svg', '.txt', '.webmanifest'
]);
const SKIP_PATHS = new Set(['scripts/audit-generalization.mjs']);

const LEGACY_SOURCE_MARKERS = Object.freeze([
  'javtwi',
  'twishare',
  'twiigle',
  'x-video-rank',
  'JVTWI',
  'TWISHARE',
  'TWIIGLE',
  'X_VIDEO_RANK'
]);

function walk(root) {
  const output = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry).replace(/\\/g, '/');
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...walk(path));
    else output.push(path);
  }
  return output;
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

const files = ROOTS.flatMap((root) => {
  try {
    return walk(root);
  } catch {
    return [];
  }
}).filter((path) => TEXT_EXTENSIONS.has(extension(path)) && !SKIP_PATHS.has(path));

const violations = [];
for (const file of files) {
  const pathLower = file.toLowerCase();
  const text = readFileSync(file, 'utf8');
  const lower = text.toLowerCase();
  for (const term of LEGACY_SOURCE_MARKERS) {
    const needle = term.toLowerCase();
    if (pathLower.includes(needle) || lower.includes(needle)) {
      violations.push(`${file}: contains inactive legacy source marker "${term}"`);
      break;
    }
  }
}

if (violations.length) {
  console.error('Generalization audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Generalization audit passed for ${files.length} text files.`);
