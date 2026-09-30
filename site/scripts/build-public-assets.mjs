import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
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

function optimizeAppLiteCss(source) {
  return source
    .replace(/\.shell \{ width: min\(1160px, 100%\); margin: 0 auto; padding: max\(14px, env\(safe-area-inset-top\)\) max\(14px, env\(safe-area-inset-right\)\) max\(30px, env\(safe-area-inset-bottom\)\) max\(14px, env\(safe-area-inset-left\)\); \}/, '.shell { margin: 0 auto; padding-block: max(14px, env(safe-area-inset-top)) max(30px, env(safe-area-inset-bottom)); }')
    .replace(/border-radius: var\(--radius\); box-shadow:/, 'box-shadow:')
    .replace(/\.top-card \{ display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px; \}/, '.top-card { display: flex; align-items: center; justify-content: space-between; gap: 20px; }')
    .replace(/\.metrics \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 10px; margin-top: 10px; \}/, '.metrics { display: grid; margin-top: 10px; }')
    .replace(/\.metric \{ position: relative; min-width: 0; padding: 17px; overflow: hidden; \}/, '.metric { position: relative; min-width: 0; overflow: hidden; }')
    .replace(/\.metric > span \{ display: block; color: var\(--muted\); font-size: \.76rem; font-weight: 740; \}/, '.metric > span { display: block; color: var(--muted); font-weight: 740; }')
    .replace(/line-height: \.95; letter-spacing: -\.045em; font-variant-numeric: tabular-nums;/, 'letter-spacing: -.045em;')
    .replace(/\.delta \{ margin-top: 9px; color: var\(--muted\); font-size: \.72rem; font-weight: 760; \}/, '.delta { margin-top: 9px; color: var(--muted); font-weight: 760; }')
    .replace(/\.card \{ min-width: 0; padding: 18px; \}/, '.card { min-width: 0; }')
    .replace(/\.section-head \{ display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; \}/, '.section-head { display: flex; justify-content: space-between; }')
    .replace(/\.host \{ max-width: 48%; color: var\(--muted\); font-size: \.75rem; text-align: right; \}/, '.host { max-width: 48%; color: var(--muted); text-align: right; }')
    .replace(/\.pill \{ padding: 6px 10px; border: 1px solid var\(--line\); border-radius: 99px; background: var\(--panel-2\); color: var\(--muted\); font-size: \.7rem; font-weight: 800; white-space: nowrap; \}/, '.pill { padding: 6px 10px; border: 1px solid var(--line); border-radius: 99px; background: var(--panel-2); color: var(--muted); font-weight: 800; white-space: nowrap; }')
    .replace(/\.legend \{ display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px 14px; color: var\(--muted\); font-size: \.71rem; \}/, '.legend { display: flex; flex-wrap: wrap; justify-content: flex-end; color: var(--muted); }')
    .replace(/\.chart-detail \{ min-height: 43px; margin-top: 9px; padding: 11px 13px; border: 1px solid var\(--line\); border-radius: 11px; background: var\(--panel-2\); color: var\(--muted\); font-size: \.77rem; line-height: 1\.5; \}/, '.chart-detail { border: 1px solid var(--line); border-radius: 11px; background: var(--panel-2); }')
    .replace(/\n  \.shell \{ padding-inline: 10px; \}/, '')
    .replace(/  \.top-card \{ align-items: stretch; flex-direction: column; gap: 14px; padding: 16px; \}/, '  .top-card { align-items: stretch; flex-direction: column; }')
    .replace(/\n  \.metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 7px; \}/, '')
    .replace(/\n  \.metric \{ padding: 14px 12px; border-radius: 16px; \}/, '')
    .replace(/\n  \.metric\.featured \{ grid-column: 1 \/ -1; display: grid; grid-template-columns: minmax\(0, 1fr\) auto; align-items: end; gap: 8px; \}/, '')
    .replace(/\n  \.metric\.featured > span \{ align-self: center; font-size: \.75rem; \}/, '')
    .replace(/\n  \.metric > span \{ font-size: \.68rem; \}/, '')
    .replace(/\n  \.metric strong \{ font-size: clamp\(1\.45rem, 7\.2vw, 2rem\); \}/, '')
    .replace(/\n  \.metric\.featured strong \{ font-size: clamp\(1\.75rem, 9vw, 2\.25rem\); \}/, '')
    .replace(/\n  \.delta \{ font-size: \.64rem; \}/, '')
    .replace(/  \.card \{ padding: 15px; border-radius: 17px; \}/, '')
    .replace(/\n  \.section-head \{ margin-bottom: 12px; \}/, '');
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
  if (path.endsWith('/app-lite.css')) return optimizeAppLiteCss(source);
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
