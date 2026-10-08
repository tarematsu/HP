import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function ensureLeaderboardRefreshQueue(run) {
  try { run(['queues', 'create', 'stationhead-leaderboard-refresh']); }
  catch (error) {
    const detail = `${error.message || ''} ${error.stderr || ''} ${error.stdout || ''}`;
    if (!/already exists/i.test(detail)) throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cli = resolve('node_modules/wrangler/bin/wrangler.js');
  ensureLeaderboardRefreshQueue(args => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}
