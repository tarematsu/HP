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

function shareCommonUiHelpers(source, file) {
  let next = source;
  let imports = '';

  if (file === 'spotify.js' || file === 'amazon-music.js') {
    imports = "import { byId as element, integerFormat as numberFormat, safeInteger as integer, svgElement } from './dashboard-ui-common.js?v=20260930.1';\n";
    next = next
      .replace("const SVG_NS = 'http://www.w3.org/2000/svg';\n", '')
      .replace("const numberFormat = new Intl.NumberFormat('ja-JP');\n", '')
      .replace(/function element\(id\) \{\n  return document\.getElementById\(id\);\n}\n\n/, '')
      .replace(/function integer\(value\) \{\n  if \(value == null \|\| value === ''\) return null;\n  const (?:number|parsed) = Number\(value\);\n  return Number\.isSafeInteger\((?:number|parsed)\) \? (?:number|parsed) : null;\n}\n\n/, '')
      .replace(/function svgElement\(name, attributes = \{}\) \{\n  const node = document\.createElementNS\(SVG_NS, name\);\n  for \(const \[key, value\] of Object\.entries\(attributes\)\) node\.setAttribute\(key, String\(value\)\);\n  return node;\n}\n\n/, '');
  } else if (file === 'apple-music.js') {
    imports = "import { byId as element, svgElement } from './dashboard-ui-common.js?v=20260930.1';\n";
    next = next
      .replace("const SVG_NS = 'http://www.w3.org/2000/svg';\n", '')
      .replace(/function element\(id\) \{\n  return document\.getElementById\(id\);\n}\n\n/, '')
      .replace(/function svgElement\(name, attributes = \{}\) \{\n  const node = document\.createElementNS\(SVG_NS, name\);\n  for \(const \[key, value\] of Object\.entries\(attributes\)\) node\.setAttribute\(key, String\(value\)\);\n  return node;\n}\n\n/, '');
  } else if (file === 'followers.js') {
    imports = "import { integerFormat as numberFormat, svgElement as createSvgNode } from './dashboard-ui-common.js?v=20260930.1';\n";
    next = next
      .replace("const SVG_NS = 'http://www.w3.org/2000/svg';\n", '')
      .replace("const numberFormat = new Intl.NumberFormat('ja-JP');\n", '')
      .replace(/function createSvgNode\(name, attributes = \{}\) \{\n  const node = document\.createElementNS\(SVG_NS, name\);\n  for \(const \[key, value\] of Object\.entries\(attributes\)\) node\.setAttribute\(key, String\(value\)\);\n  return node;\n}\n/, '');
  } else if (file === 'hinata.js') {
    imports = "import { byId, cssColor, decimalOneFormat as decimal, finiteNumber as finite, integerFormat as integer, setText, svgElement } from './dashboard-ui-common.js?v=20260930.1';\n";
    next = next
      .replace("const SVG_NS = 'http://www.w3.org/2000/svg';\n", '')
      .replace("const integer = new Intl.NumberFormat('ja-JP');\n", '')
      .replace("const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });\n", '')
      .replace(/const byId = \(id\) => document\.getElementById\(id\);\n/, '')
      .replace(/const finite = \(value\) => \{\n  if \(value === null \|\| value === undefined \|\| value === ''\) return null;\n  const number = Number\(value\);\n  return Number\.isFinite\(number\) \? number : null;\n};\n/, '')
      .replace(/function setText\(id, value\) \{\n  const node = byId\(id\);\n  if \(node\) node\.textContent = String\(value\);\n}\n\n/, '')
      .replace(/function cssColor\(name, fallback\) \{\n  return getComputedStyle\(document\.documentElement\)\.getPropertyValue\(name\)\.trim\(\) \|\| fallback;\n}\n\n/, '')
      .replace(/function svgElement\(name, attributes = \{}, text = null\) \{\n  const node = document\.createElementNS\(SVG_NS, name\);\n  for \(const \[key, value\] of Object\.entries\(attributes\)\) node\.setAttribute\(key, String\(value\)\);\n  if \(text != null\) node\.textContent = String\(text\);\n  return node;\n}\n\n/, '');
  }

  return imports ? `${imports}${next}` : next;
}

function optimizeBundledModule(source, path) {
  const file = basename(path);
  let next = shareCommonUiHelpers(normalizeCanvasPresentation(source, file), file);

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

function optimizeMonochromeCss(source) {
  return source
    .replace(/\n\.top-card,\n\.card,\n\.metric,\n\.guide,\n\.summary-cards article \{\n  border-color: #d3d3d3;\n  background: rgba\(255, 255, 255, \.98\);\n  box-shadow: 0 10px 28px rgba\(0, 0, 0, \.06\);\n}\n/, '\n')
    .replace(/\.metric\.featured,\n\.daily-total-row \{\n  background: #f1f1f1;\n}/, '.daily-total-row {\n  background: #f1f1f1;\n}')
    .replace(/\.mode-tabs,\n\.range-presets,\n\.pill,\n\.chart-detail,\n\.like-rank-number,\n\.like-rank-metrics span,\nth \{\n  background: #f4f4f4;\n}/, '.like-rank-metrics span,\nth {\n  background: #f4f4f4;\n}')
    .replace(/\n\.range-presets button\.active \{\n  background: #ffffff;\n  color: #111111;\n  box-shadow: 0 2px 8px rgba\(0, 0, 0, \.08\);\n}\n/, '\n')
    .replace(/\n\.status-message \{\n  box-shadow: 0 8px 24px rgba\(0, 0, 0, \.1\);\n}\n/, '\n')
    .replace(/\n\.section-head \{\n  margin-bottom: 8px;\n}\n\n\.section-head h2 \{\n  font-size: \.94rem;\n  font-weight: 760;\n}\n\n\.host \{\n  font-size: \.68rem;\n}\n/, '\n')
    .replace(/\.chart-detail \{\n  min-height: 0;\n  margin-top: 4px;\n  padding: 3px 0;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  font-size: \.68rem;\n}/, '.chart-detail {\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n}')
    .replace(/\n\.chart-axis,\n\.chart-foot \{\n  font-size: \.62rem;\n}\n/, '\n')
    .replace(/\.range-presets button \{\n  min-height: 32px;\n  padding: 4px 7px;\n  border-radius: 0;\n  font-size: \.66rem;\n}/, '.range-presets button {\n  padding: 4px 7px;\n  border-radius: 0;\n}')
    .replace(/\n\.controls label \{\n  gap: 2px;\n  font-size: \.64rem;\n}\n/, '\n')
    .replace(/\n\.notice \{\n  min-height: 0;\n  margin: 5px 0;\n  font-size: \.66rem;\n}\n/, '\n')
    .replace(/\.summary-cards span \{\n  font-size: \.64rem;\n  font-weight: 650;\n}/, '.summary-cards span {\n  font-weight: 650;\n}')
    .replace(/\n\.like-actions \{\n  gap: 5px;\n  margin: 7px 0;\n}\n\n\.like-ranking \{\n  gap: 0;\n}\n/, '\n')
    .replace(/\.like-rank-item \{\n  padding: 7px 0;\n  border: 0;\n  border-bottom: 1px solid #e6e6e6;\n  border-radius: 0;\n}/, '.like-rank-item {\n  border: 0;\n  border-bottom: 1px solid #e6e6e6;\n}')
    .replace(/\.like-rank-metrics span \{\n  padding: 4px 6px;\n  border-radius: 3px;\n  font-size: \.6rem;\n}/, '.like-rank-metrics span {\n  padding: 4px 6px;\n  border-radius: 3px;\n}')
    .replace(/\n  \.shell \{\n    padding-inline: 8px;\n  }\n\n  \.top-card\.dashboard-header \{\n    gap: 6px;\n    padding-top: 3px;\n  }\n\n  \.mode-tabs\.dashboard-tabs \{\n    grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);\n  }\n\n  \.metrics \{\n    gap: 0;\n  }\n\n  \.metric,\n  \.metric\.featured \{\n    padding: 8px 7px 9px;\n    border-radius: 0;\n  }\n/, '\n')
    .replace(/  \.primary-grid > \.card:first-child,\n  \.primary-grid > \.card:last-child \{\n    padding: 11px 0;\n    border-right: 0;\n  }/, '  .primary-grid > .card:first-child,\n  .primary-grid > .card:last-child {\n    border-right: 0;\n  }')
    .replace(/  \.summary-cards article,\n  \.summary-cards\.likes-summary article \{\n    border-bottom: 1px solid #ececec;\n  }/, '  .summary-cards article,\n  .summary-cards.likes-summary article {\n    border-bottom: 1px solid #ececec;\n  }')
    .replace(/\n  \.chart-panel,\n  \.data-panel,\n  \.goal-card,\n  \.chart-card \{\n    padding: 11px 0;\n    border-radius: 0;\n  }\n/, '\n')
    .replace(/\n  \.mode-tabs\.dashboard-tabs \{\n    grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);\n  }\n\n  \.mode-tabs\.dashboard-tabs button \{\n    min-height: 34px;\n    padding: 4px 2px;\n    font-size: \.63rem;\n  }\n/, '\n');
}

function optimizeBundledCss(source, path) {
  if (path.endsWith('/history/history-lite.css')) {
    const historySpecificStart = source.indexOf('.mode-tabs {');
    return historySpecificStart >= 0 ? source.slice(historySpecificStart) : source;
  }
  if (path.endsWith('/monochrome.css')) return optimizeMonochromeCss(source);
  return source;
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