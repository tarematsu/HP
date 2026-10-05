import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');

function rendererSources(repositoryRoot) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const source = readFileSync(path, 'utf8');
    for (const pattern of [
      /(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g,
      /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]) {
      for (const match of source.matchAll(pattern)) {
        if (match[1].startsWith('.')) visit(resolve(dirname(path), match[1].split('?')[0]));
      }
    }
  }
  for (const name of ['source', 'renderer', 'publication', 'refresh']) {
    visit(resolve(repositoryRoot, `worker/src/history-read-model-${name}.js`));
  }
  return [...seen].sort();
}

// Deployment and Actions recovery use the same deterministic renderer identity.
export function historyRendererSourceRevision(repositoryRoot = root) {
  const files = rendererSources(repositoryRoot);
  const hash = createHash('sha256');
  for (const path of files) hash.update(relative(repositoryRoot, path)).update('\0').update(readFileSync(path)).update('\0');
  return `history-${hash.digest('hex').slice(0, 24)}`;
}
