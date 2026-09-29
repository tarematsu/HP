import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const publicRoot = resolve(siteRoot, 'public');
const assetsDir = resolve(publicRoot, 'assets');

const cssFiles = [
  'app-lite.css',
  'monochrome.css',
  'dashboard-root-presentation.css',
  'dashboard-fixes.css',
  'screenshot-audit-cleanup.css',
  'period-display-fixes.css',
  'dashboard-current-enhancements.css',
  'pages-layout.css',
  'pages-tabs-layout.css',
  'dashboard-ui-common.css',
  'spotify.css',
  'first-week-comparison.css',
  'played-tracks.css',
  'apple-music.css',
  'amazon-music.css',
  'followers.css',
  'hinata.css',
  'history/history-past-toggle.css',
  'history/history-range-navigator.css',
];

const browserModuleResolver = {
  name: 'browser-module-resolver',
  setup(buildApi) {
    buildApi.onResolve({ filter: /\.m?js(?:[?#].*)?$/ }, (args) => {
      const clean = args.path.replace(/[?#].*$/, '');
      if (!clean.startsWith('/') && !clean.startsWith('.')) return null;
      const path = clean.startsWith('/')
        ? resolve(publicRoot, `.${clean}`)
        : resolve(args.resolveDir, clean);
      return { path };
    });
  },
};

await mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [resolve(publicRoot, 'dashboard-metrics.js')],
  outfile: resolve(assetsDir, 'dashboard.min.js'),
  bundle: true,
  splitting: false,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  charset: 'utf8',
  plugins: [browserModuleResolver],
});

await build({
  stdin: {
    contents: cssFiles.map((file) => `@import "./public/${file}";`).join('\n'),
    resolveDir: siteRoot,
    sourcefile: 'dashboard-bundle.css',
    loader: 'css',
  },
  outfile: resolve(assetsDir, 'dashboard.min.css'),
  bundle: true,
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
});

const [js, css] = await Promise.all([
  stat(resolve(assetsDir, 'dashboard.min.js')),
  stat(resolve(assetsDir, 'dashboard.min.css')),
]);

console.log(JSON.stringify({
  event: 'pages_assets_built',
  js_bytes: js.size,
  css_bytes: css.size,
  total_bytes: js.size + css.size,
  browser_files: 2,
}));
