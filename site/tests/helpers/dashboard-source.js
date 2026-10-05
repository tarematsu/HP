import { readFileSync } from 'node:fs';

// Static contracts follow the router's responsibility-specific modules.
export function dashboardRouterSource() {
  return ['dashboard-navigation-config.js', 'dashboard-view-loader.js', 'dashboard-tabs.js']
    .map(file => readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8'))
    .join('\n');
}

// Static checks read a responsibility and its actual imports, rather than a retired file.
export function browserSource(file) {
  const visited = new Set();
  function read(url) {
    url.search = ''; url.hash = '';
    if (visited.has(url.href)) return '';
    visited.add(url.href);
    const source = readFileSync(url, 'utf8');
    const dependencies = [...source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+\.js(?:\?[^'"]*)?)['"]/g)]
      .map(match => match[1]).filter(path => path.startsWith('.') || path.startsWith('/'));
    return source + '\n' + dependencies.map(path => path.startsWith('/')
      ? new URL(`../../public${path}`, import.meta.url) : new URL(path, url))
      .filter(dependency => (dependency.pathname.includes('/public/stationhead/') || dependency.pathname.includes('/public/history/') || dependency.pathname.includes('/public/leaderboard/')))
      .map(read).join('\n');
  }
  return read(new URL(`../../public/${file}`, import.meta.url));
}
