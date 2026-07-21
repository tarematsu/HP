import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'public', 'scripts'];

function jsFiles(root) {
  const output = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...jsFiles(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) output.push(path);
  }
  return output;
}

const files = ROOTS.flatMap(jsFiles);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Checked syntax for ${files.length} JavaScript files.`);
