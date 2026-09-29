import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve, relative } from 'node:path';
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
  'spotify.css',
  'first-week-comparison.css',
  'played-tracks.css',
  'apple-music.css',
  'amazon-music.css',
  'followers.css',
  'hinata.css',
  'history/history-past-toggle.css',
  'history/history-range-navigator.css',
  'dashboard-ui-common.css',
];

const canvasTransforms = new Map([
  ['dashboard-chart-comparison.js', [
    ["context.font = 'bold 10px system-ui';", "context.font = '600 11px system-ui';"],
    ["context.font = '10px system-ui';", "context.font = '11px system-ui';"],
    ["context.strokeStyle = 'rgba(31,45,68,.10)';", "context.strokeStyle = 'rgba(31,45,68,.12)';"],
    ["drawSeries(context, current, xFor, yOnline, '#111', 2.5);", "drawSeries(context, current, xFor, yOnline, '#111', 2);"],
    ["context.arc(xFor(minRow.observed_at), yOnline(currentMin), 3.5,", "context.arc(xFor(minRow.observed_at), yOnline(currentMin), 3,"],
    ["context.arc(xFor(maxRow.observed_at), yOnline(currentMax), 3.5,", "context.arc(xFor(maxRow.observed_at), yOnline(currentMax), 3,"],
  ]],
  ['first-week-comparison.js', [
    ["context.font = '10.5px system-ui';", "context.font = '11px system-ui';"],
    ['context.lineWidth = 1.8;', 'context.lineWidth = 2;'],
  ]],
  ['history-period-chart.js', [
    ["context.font = '10.5px system-ui';", "context.font = '11px system-ui';"],
    ["context.font = width < 480 ? '9px system-ui' : '10px system-ui';", "context.font = '11px system-ui';"],
    ["context.strokeStyle = 'rgba(31,45,68,.24)';", "context.strokeStyle = 'rgba(31,45,68,.12)';"],
    ["{ key: 'listener_avg', label: '平均同接', color: '#000000', width: 2.6 }", "{ key: 'listener_avg', label: '平均同接', color: '#000000', width: 2 }"],
    ["{ key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 1.9 }", "{ key: 'listener_max', label: '最大同接', color: cssColor('--orange', '#c56a18'), width: 2 }"],
    ["{ key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 1.9 }", "{ key: 'listener_min', label: '最小同接', color: cssColor('--blue', '#2776b9'), width: 2 }"],
  ]],
  ['history-ranking-chart.js', [
    ["context.font = '10.5px system-ui';", "context.font = '11px system-ui';"],
    ["context.font = '10px system-ui';", "context.font = '11px system-ui';"],
    ["context.strokeStyle = 'rgba(31,45,68,.16)';", "context.strokeStyle = 'rgba(31,45,68,.12)';"],
    ['context.lineWidth = 2.4;', 'context.lineWidth = 2;'],
    ['context.arc(positions[index], yFor(rank), 2.5,', 'context.arc(positions[index], yFor(rank), 3,'],
  ]],
]);

function normalizeCanvasPresentation(source, file) {
  let next = source;
  for (const [before, after] of canvasTransforms.get(file) || []) next = next.replaceAll(before, after);
  return next;
}

function optimizeBundledModule(source, path) {
  const file = basename(path);
  let next = normalizeCanvasPresentation(source, file);

  if (file === 'dashboard-header.js') {
    const runtimeStart = next.indexOf('const KEYBOARD_NAVIGATION_CLASS');
    if (runtimeStart >= 0) next = next.slice(runtimeStart);
  }

  if (file === 'dashboard-ui-common.js') {
    next = next.replace(
      /export function ensureStylesheet\([\s\S]*?\n}\n\nfunction firstMatch/,
      'function firstMatch',
    );
    next = next.replace(
      "export function mountDashboardShell({ style, tab, view } = {}) {\n  ensureStylesheet('/dashboard-ui-common.css?v=20260930.1', 'dashboard-ui-common');\n  if (style?.href && style?.key) ensureStylesheet(style.href, style.key);\n",
      'export function mountDashboardShell({ tab, view } = {}) {\n',
    );
  }

  if (next.includes('mountDashboardShell({')) {
    next = next.replace(/^\s*style:\s*\{[^}\n]*\},\n/gm, '');
  }

  if (file === 'history-past-toggle-shell.js') {
    next = next
      .replace(/^import \{ ensureStylesheet \}[^\n]*\n\n/, '')
      .replace(/^ensureStylesheet\([^\n]*\);\n/m, '');
  }

  if (file === 'history-range-navigator.js') {
    next = next
      .replace(/\n  function ensureStylesheet\(\) \{[\s\S]*?\n  }\n\n  function todayUtc/, '\n  function todayUtc')
      .replace(/\n  ensureStylesheet\(\);/, '');
  }

  return next;
}

function optimizeBundledCss(source, path) {
  if (!path.endsWith('/history/history-lite.css')) return source;
  const historySpecificStart = source.indexOf('.mode-tabs {');
  return historySpecificStart >= 0 ? source.slice(historySpecificStart) : source;
}

const browserModuleResolver = {
  name: 'browser-module-resolver',
  setup(buildApi) {
    buildApi.onResolve({ filter: /\.m?js(?:[?#].*)?$/ }, (args) => {
      const clean = args.path.replace(/[?#].*$/, '');
      if (args.kind === 'entry-point' || clean.startsWith(publicRoot)) return null;
      if (!clean.startsWith('/') && !clean.startsWith('.')) return null;
      const path = clean.startsWith('/')
        ? resolve(publicRoot, `.${clean}`)
        : resolve(args.resolveDir, clean);
      return { path };
    });
    buildApi.onLoad({ filter: /\.m?js$/ }, async (args) => ({
      contents: optimizeBundledModule(await readFile(args.path, 'utf8'), args.path),
      loader: 'js',
    }));
  },
};

const publicCssResolver = {
  name: 'public-css-resolver',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^\// }, (args) => {
      if (args.kind !== 'import-rule') return null;
      return { path: resolve(publicRoot, `.${args.path.replace(/[?#].*$/, '')}`) };
    });
    buildApi.onLoad({ filter: /\.css$/ }, async (args) => ({
      contents: optimizeBundledCss(await readFile(args.path, 'utf8'), args.path),
      loader: 'css',
    }));
  },
};

function inputContributions(metafile, limit = 20) {
  const bytes = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, details] of Object.entries(output.inputs || {})) {
      bytes.set(input, (bytes.get(input) || 0) + (details.bytesInOutput || 0));
    }
  }
  return [...bytes.entries()]
    .map(([input, bytesInOutput]) => ({
      input: input.startsWith(siteRoot) ? relative(siteRoot, input) : input,
      bytes: bytesInOutput,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

await mkdir(assetsDir, { recursive: true });

const jsBuild = await build({
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
  metafile: true,
  plugins: [browserModuleResolver],
});

const cssBuild = await build({
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
  metafile: true,
  plugins: [publicCssResolver],
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
  largest_js_inputs: inputContributions(jsBuild.metafile),
  largest_css_inputs: inputContributions(cssBuild.metafile),
}));