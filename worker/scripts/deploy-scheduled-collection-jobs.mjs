import { historyRendererSourceRevision } from './history-renderer-revision.mjs';
import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(
  ['deploy', '--config', 'wrangler.scheduled-collection-jobs.jsonc', '--var', `HISTORY_READ_MODEL_RENDERER_REVISION:${historyRendererSourceRevision()}`],
  { capture: true, mirror: true },
);
