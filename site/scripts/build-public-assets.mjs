import { mkdir, stat, rm } from 'node:fs/promises';
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
  'dashboard-presentation.css',
  'dashboard-current-enhancements.css',
  'pages-layout.css',
  'dashboard-navigation.css',
  'spotify.css',
  'first-week-comparison.css',
  'played-tracks.css',
  'apple-music.css',
  'amazon-music.css',
  'followers.css',
  'history/history-past-toggle.css',
  'history/history-range-navigator.css',
  'music-service-common.css',
  'regional-music.css',
  'dashboard-ui-common.css',
  'mobile-layout-refinements.css',
];

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

await rm(resolve(assetsDir, 'chunks'), { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

const jsBuild = await build({
  entryPoints: { 'dashboard.min': resolve(publicRoot, 'dashboard-metrics.js') },
  outdir: assetsDir,
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
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

const jsOutputs = Object.entries(jsBuild.metafile.outputs);
const initialOutputs = new Set();
function collectInitial(path) {
  if (initialOutputs.has(path)) return;
  initialOutputs.add(path);
  for (const dependency of jsBuild.metafile.outputs[path]?.imports || []) {
    if (dependency.kind === 'import-statement' && !dependency.external) collectInitial(dependency.path);
  }
}
collectInitial(jsOutputs.find(([path]) => path.endsWith('/dashboard.min.js'))[0]);
const initialJsBytes = [...initialOutputs].reduce((total, path) => total + jsBuild.metafile.outputs[path].bytes, 0);
const totalJsBytes = jsOutputs.reduce((total, [, output]) => total + output.bytes, 0);

const [js, css] = await Promise.all([
  stat(resolve(assetsDir, 'dashboard.min.js')),
  stat(resolve(assetsDir, 'dashboard.min.css')),
]);

console.log(JSON.stringify({
  event: 'pages_assets_built',
  js_bytes: js.size,
  css_bytes: css.size,
  initial_js_bytes: initialJsBytes,
  total_js_bytes: totalJsBytes,
  initial_total_bytes: initialJsBytes + css.size,
  total_bytes: totalJsBytes + css.size,
  browser_files: jsOutputs.length + 1,
  largest_js_inputs: inputContributions(jsBuild.metafile),
  largest_css_inputs: inputContributions(cssBuild.metafile),
}));
