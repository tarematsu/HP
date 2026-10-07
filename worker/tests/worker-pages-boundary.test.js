import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

function sourceFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (['.js', '.mjs', '.cjs'].includes(extname(entry.name))) result.push(path);
  }
  return result;
}

test('Worker runtime and maintenance scripts never import Pages implementation modules', () => {
  const roots = [
    new URL('../src/', import.meta.url),
    new URL('../scripts/', import.meta.url),
  ];
  const violations = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*site\/functions\//.test(source)
          || /import\s*\(\s*['"][^'"]*site\/functions\//.test(source)) {
        violations.push(file);
      }
    }
  }
  assert.deepEqual(violations, []);
});
