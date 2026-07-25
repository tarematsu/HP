import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const videoRoot = join(root, '..', 'video');
const deployScript = join(root, 'scripts', 'deploy-existing.mjs');
const videoDependencyMarker = join(videoRoot, 'node_modules', '@cloudflare', 'puppeteer', 'package.json');

function ensureVideoDependencies() {
  if (existsSync(videoDependencyMarker)) return;
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('Installing imported video Worker dependencies before bundling.');
  execFileSync(npmCommand, ['--prefix', videoRoot, 'install', '--no-audit', '--no-fund'], {
    cwd: root,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit'
  });
  if (!existsSync(videoDependencyMarker)) {
    throw new Error('The imported video Worker dependency @cloudflare/puppeteer was not installed');
  }
}

ensureVideoDependencies();
execFileSync(process.execPath, [deployScript, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit'
});
