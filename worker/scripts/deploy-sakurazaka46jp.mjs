import { runWrangler } from './cloudflare-queues.mjs';

const configName = 'wrangler.sakurazaka46jp.jsonc';
runWrangler(['queues', 'create', 'regional-music-daily'], { allowFailure: true });
runWrangler(['queues', 'create', 'regional-music-daily-dlq'], { allowFailure: true });
runWrangler(['deploy', '--config', configName]);
console.log(JSON.stringify({
  event: 'sakurazaka_worker_deployed',
  script: 'sh-sakurazaka46jp',
  queue: 'stationhead-sakurazaka46jp',
}));
