import { runWrangler } from './cloudflare-queues.mjs';
import { bootstrapProducerReadModel } from './bootstrap-producer-read-model.mjs';

const configName = 'wrangler.nogizaka46smej.jsonc';
const queue = 'stationhead-nogizaka46smej';
const deadLetterQueue = `${queue}-dlq`;

runWrangler(['queues', 'create', queue], { allowFailure: true });
runWrangler(['queues', 'create', deadLetterQueue], { allowFailure: true });
runWrangler(['deploy', '--config', configName]);
console.log(JSON.stringify(await bootstrapProducerReadModel(configName)));
console.log(JSON.stringify({
  event: 'nogizaka_worker_deployed',
  script: 'sh-nogizaka46smej',
  queue,
}));
