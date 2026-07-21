import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const settingsFile = process.argv.includes('--settings')
  ? process.argv[process.argv.indexOf('--settings') + 1]
  : 'local-settings.txt';
const mappings = Object.freeze({
  ADMIN: 'ADMIN_TOKEN',
  DATABASE: 'PRODUCTION_D1_DATABASE_ID',
  HOST: 'MEDIA_HOST',
  A: 'SOURCE_A_URL',
  B: 'SOURCE_B_URL',
  C: 'SOURCE_C_URL',
  D: 'SOURCE_D_URL',
  E: 'SOURCE_E_URL'
});

function parsePairs(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], {
      shell: process.platform === 'win32',
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`wrangler failed: ${args.join(' ')}`)));
  });
}

const settings = parsePairs(await readFile(settingsFile, 'utf8'));
const project = settings.PROJECT_NAME || 'video-scraper';
const targets = (settings.TARGETS || 'production,preview').split(',').map((value) => value.trim()).filter(Boolean);
const vars = {};
for (const [inputKey, outputKey] of Object.entries(mappings)) {
  if (settings[inputKey]) vars[outputKey] = settings[inputKey];
}
if (!Object.keys(vars).length) throw new Error(`No values found in ${settingsFile}`);

const dir = await mkdtemp(join(tmpdir(), 'pages-vars-'));
try {
  const file = join(dir, 'vars.json');
  await writeFile(file, JSON.stringify(vars, null, 2));
  for (const target of targets) {
    await run(['pages', 'secret', 'bulk', file, '--project-name', project, '--env', target]);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
