import { mkdir, stat, rm, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const publicRoot = resolve(siteRoot, 'public');
const assetsDir = resolve(publicRoot, 'assets');

const cssGroups = Object.freeze({
  dashboard: [
    'app-lite.css',
    'monochrome.css',
    'dashboard-presentation.css',
    'dashboard-current-enhancements.css',
    'pages-layout.css',
    'dashboard-navigation.css',
    'dashboard-ui-common.css',
    'mobile-layout-refinements.css',
  ],
  stationhead: [
    'history/history-lite.css',
    'first-week-comparison.css',
    'played-tracks.css',
    'followers.css',
    'leaderboard.css',
    'hinata.css',
    'history/history-past-toggle.css',
    'history/history-range-navigator.css',
  ],
  subscriptions: [
    'spotify.css',
    'apple-music.css',
    'amazon-music.css',
    'music-service-common.css',
    'followers.css',
    'leaderboard.css',
  ],
});

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

function inputContributions(metafiles, limit = 20) {
  const bytes = new Map();
  for (const metafile of Array.isArray(metafiles) ? metafiles : [metafiles]) {
    for (const output of Object.values(metafile.outputs)) {
      for (const [input, details] of Object.entries(output.inputs || {})) {
        bytes.set(input, (bytes.get(input) || 0) + (details.bytesInOutput || 0));
      }
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

async function buildCssBundle(name, files) {
  return build({
    stdin: {
      contents: '@layer base, features, layout;\n' + files.map((file) => {
        const layer = name !== 'dashboard' ? 'features'
          : ['pages-layout.css', 'dashboard-navigation.css', 'dashboard-ui-common.css', 'mobile-layout-refinements.css', 'dashboard-presentation.css'].includes(file) ? 'layout' : 'base';
        return `@import "./public/${file}" layer(${layer});`;
      }).join('\n'),
      resolveDir: siteRoot,
      sourcefile: `${name}-bundle.css`,
      loader: 'css',
    },
    outfile: resolve(assetsDir, `${name}.min.css`),
    bundle: true,
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    metafile: true,
    plugins: [publicCssResolver],
  });
}

// Discard chunks from previous builds; deploy only the current module graph.
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

const cssBuilds = await Promise.all(Object.entries(cssGroups).map(async ([name, files]) => [
  name,
  await buildCssBundle(name, files),
]));
const cssBuildMap = new Map(cssBuilds);

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

const js = await stat(resolve(assetsDir, 'dashboard.min.js'));
const cssSizes = Object.fromEntries(await Promise.all(Object.keys(cssGroups).map(async (name) => [
  name,
  (await stat(resolve(assetsDir, `${name}.min.css`))).size,
])));
const initialCssBytes = cssSizes.dashboard;
const totalCssBytes = Object.values(cssSizes).reduce((total, size) => total + size, 0);

const report = {
  event: 'pages_assets_built',
  js_bytes: js.size,
  css_bytes: initialCssBytes,
  stationhead_css_bytes: cssSizes.stationhead,
  subscriptions_css_bytes: cssSizes.subscriptions,
  total_css_bytes: totalCssBytes,
  initial_js_bytes: initialJsBytes,
  total_js_bytes: totalJsBytes,
  initial_total_bytes: initialJsBytes + initialCssBytes,
  total_bytes: totalJsBytes + totalCssBytes,
  browser_files: jsOutputs.length + Object.keys(cssGroups).length,
  largest_js_inputs: inputContributions(jsBuild.metafile),
  largest_css_inputs: inputContributions([...cssBuildMap.values()].map((result) => result.metafile)),
};

const routeModules = {
  current: ['current-shell.js', 'stationhead-channel.js'],
  hinata: ['hinata-shell.js', 'hinata.js'],
  nogizaka: ['nogizaka-listening-party-shell.js', 'nogizaka-listening-party.js'],
  history: ['history-shell.js', 'history/history-main.js'],
  likes: ['likes-shell.js', 'history/history-likes.js'],
  'played-tracks': ['played-tracks-shell.js', 'played-tracks.js'],
  spotify: ['spotify-shell.js', 'spotify.js'],
  'apple-music': ['apple-music-shell.js', 'apple-music.js'],
  'amazon-music': ['amazon-music-shell.js', 'amazon-music.js'],
  'youtube-music': ['youtube-music-shell.js', 'youtube-music.js'],
  kkbox: ['kkbox-shell.js', 'kkbox.js'],
  qq_music: ['qq-music-shell.js', 'qq-music.js'],
  kugou_music: ['kugou-music-shell.js', 'kugou-music.js'],
  ranking: ['leaderboard-shell.js', 'leaderboard.js'],
  followers: ['followers-shell.js', 'followers.js'],
};
function routeGraph(inputs) {
  const outputs = new Set(initialOutputs);
  function visit(path) {
    if (outputs.has(path)) return;
    outputs.add(path);
    for (const dependency of jsBuild.metafile.outputs[path]?.imports || []) {
      if (!dependency.external) visit(dependency.path);
    }
  }
  for (const input of inputs) {
    const output = jsOutputs.find(([, details]) => details.entryPoint && resolve(details.entryPoint) === resolve(publicRoot, input));
    if (!output) throw new Error(`Missing route output: ${input}`);
    visit(output[0]);
  }
  return outputs;
}
report.route_js_graph_bytes = Object.fromEntries(Object.entries(routeModules).map(([route, inputs]) => [
  route, [...routeGraph(inputs)].reduce((total, path) => total + jsBuild.metafile.outputs[path].bytes, 0),
]));
const allOutputPaths = [...jsOutputs.map(([path]) => path), ...Object.keys(cssGroups).map((name) => resolve(assetsDir, `${name}.min.css`))];
const gzipSizes = new Map(await Promise.all(allOutputPaths.map(async (path) => [path, gzipSync(await readFile(path)).length])));
report.gzip_estimate = {
  initial_js_bytes: [...initialOutputs].reduce((sum, path) => sum + gzipSizes.get(path), 0),
  initial_css_bytes: gzipSizes.get(resolve(assetsDir, 'dashboard.min.css')),
  total_bytes: [...gzipSizes.values()].reduce((sum, value) => sum + value, 0),
};
report.html_bytes = (await stat(resolve(publicRoot, 'index.html'))).size;
// These are build graph sizes and local gzip estimates, not production network measurements.
const budgets = { initial_js_bytes: 25_000, css_bytes: 30_000, total_bytes: 310_000 };
for (const [metric, limit] of Object.entries(budgets)) {
  if (report[metric] > limit) throw new Error(`Pages asset budget exceeded: ${metric} ${report[metric]} > ${limit}`);
}
await mkdir(resolve(siteRoot, 'artifacts'), { recursive: true });
await writeFile(resolve(siteRoot, 'artifacts/pages-assets.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
