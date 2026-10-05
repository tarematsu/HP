import { readFileSync } from 'node:fs';

// Static contracts follow the router's responsibility-specific modules.
export function dashboardRouterSource() {
  return ['dashboard-navigation-config.js', 'dashboard-view-loader.js', 'dashboard-tabs.js']
    .map(file => readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8'))
    .join('\n');
}
