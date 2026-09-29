import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const assetsDir = resolve(scriptDir, '../public/assets');
const limits = Object.freeze({
  js: 175_000,
  css: 65_000,
  total: 238_000,
});

const [js, css] = await Promise.all([
  stat(resolve(assetsDir, 'dashboard.min.js')),
  stat(resolve(assetsDir, 'dashboard.min.css')),
]);
const total = js.size + css.size;
const failures = [];
if (js.size > limits.js) failures.push(`JS ${js.size} > ${limits.js}`);
if (css.size > limits.css) failures.push(`CSS ${css.size} > ${limits.css}`);
if (total > limits.total) failures.push(`total ${total} > ${limits.total}`);

console.log(JSON.stringify({
  event: 'pages_asset_budget',
  js_bytes: js.size,
  css_bytes: css.size,
  total_bytes: total,
  limits,
  ok: failures.length === 0,
}));

if (failures.length) {
  throw new Error(`Pages asset budget exceeded: ${failures.join(', ')}`);
}
