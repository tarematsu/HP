import { runWrangler } from './cloudflare-queues.mjs';

const configName = 'wrangler.nogizaka46smej.jsonc';
runWrangler(['deploy', '--config', configName]);
console.log(JSON.stringify({
  event: 'nogizaka_worker_deployed',
  script: 'sh-nogizaka46smej',
  queue: 'stationhead-nogizaka46smej',
}));
