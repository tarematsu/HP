import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const selector = fileURLToPath(new URL('../scripts/select-worker-deploys.mjs', import.meta.url));
const SAKURAZAKA = 'sh-sakurazaka46jp';
const NOGIZAKA = 'sh-nogizaka46smej';
const RECOVERY = 'sh-buddies-recovery';
const COLLECTOR = 'sh-buddies-collector';
const OHISAMA = 'sh-ohisama-collector';
const SPOTIFY = 'sh-spotify-playcount-collector';
const AMAZON = 'sh-amazon-music-collector';
const RUNTIME = 'sh-runtime-orchestrator';
const ALL_WORKERS = [SAKURAZAKA, NOGIZAKA, RECOVERY, COLLECTOR, OHISAMA, SPOTIFY, AMAZON, RUNTIME];
const BUDDIES_RUNTIME_WORKERS = [RECOVERY, COLLECTOR, RUNTIME];

function select(paths = [], args = []) {
  return JSON.parse(execFileSync(process.execPath, [selector, ...args], {
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  }));
}

test('domain modules select every Worker whose bundle imports them', () => {
  assert.deepEqual(select(['worker/src/persist-channel-entry.js']).workers, [RECOVERY, COLLECTOR]);
  for (const path of [
    'site/functions/lib/d1-lean-ingest.js',
    'site/functions/lib/d1-optimized-ingest.js',
  ]) {
    assert.deepEqual(select([path]).workers, BUDDIES_RUNTIME_WORKERS, path);
  }
  assert.deepEqual(select(['worker/src/persist-structure-stages.js']).workers, [RECOVERY, COLLECTOR]);
  for (const path of [
    'worker/src/minute-enrichment-playback-stages.js',
    'worker/src/track-metadata-entry.js',
    'worker/src/pages-response-store.js',
    'worker/src/minute-derive-entry.js',
    'worker/src/runtime-queue.js',
  ]) {
    assert.deepEqual(select([path]).workers, [RUNTIME], path);
  }
  assert.deepEqual(select(['worker/src/buddies-collector-entry.js']).workers, [COLLECTOR]);
  assert.deepEqual(select(['worker/src/ohisama-collector-entry.js']).workers, [OHISAMA]);
  assert.deepEqual(select(['worker/src/buddies-recovery-entry.js']).workers, [RECOVERY]);
  assert.deepEqual(select(['worker/src/sakurazaka-raw-materializer.js']).workers, [SAKURAZAKA, NOGIZAKA]);
  assert.deepEqual(select(['worker/src/nogizaka-raw-materializer.js']).workers, [NOGIZAKA]);
  assert.deepEqual(select(['worker/src/spotify-playcount-collector.js']).workers, [SPOTIFY]);
  assert.deepEqual(select(['worker/src/spotify-playcount-entry.js']).workers, [SPOTIFY]);
  assert.deepEqual(select(['worker/src/amazon-music-pipeline.js']).workers, [AMAZON]);
  assert.deepEqual(select(['worker/src/amazon-music-entry.js']).workers, [AMAZON]);
});

test('Actions-only offline modules do not redeploy Workers', () => {
  for (const path of [
    'worker/src/minute-facts-backfill-stages.js',
    'worker/src/minute-facts-gap-scan.js',
    'worker/src/minute-rebuild-entry.js',
    'worker/src/monitor-maintenance-entry.js',
    'worker/src/pages-read-model-entry.js',
    'worker/src/pages-read-model-dispatch.js',
    'worker/src/pages-track-history-publication-queue.js',
    'worker/src/pages-track-history-split-cycle.js',
    'worker/src/runtime-budgeted-entry.js',
    'worker/src/runtime-d1-coordinator.js',
    'worker/src/runtime-scheduled.js',
    'worker/src/runtime-stream-prediction-dispatch.js',
  ]) {
    assert.deepEqual(select([path]).workers, [], path);
  }
});

test('deployment support changes select the owning Worker', () => {
  assert.deepEqual(select(['worker/scripts/deploy-buddies-recovery.mjs']), {
    changed_paths: ['worker/scripts/deploy-buddies-recovery.mjs'],
    workers: [RECOVERY],
    commands: ['deploy:buddies-recovery'],
    diagnostics: [],
  });
  assert.deepEqual(select(['worker/scripts/deploy-buddies-collector.mjs']), {
    changed_paths: ['worker/scripts/deploy-buddies-collector.mjs'],
    workers: [COLLECTOR],
    commands: ['deploy:buddies-collector'],
    diagnostics: [],
  });
  assert.deepEqual(select(['worker/scripts/deploy-ohisama-collector.mjs']), {
    changed_paths: ['worker/scripts/deploy-ohisama-collector.mjs'],
    workers: [OHISAMA],
    commands: ['deploy:ohisama-collector'],
    diagnostics: [],
  });
  assert.deepEqual(select(['worker/scripts/ohisama-schema.sql']).workers, [OHISAMA]);
  assert.deepEqual(select(['worker/scripts/deploy-spotify-playcount.mjs']), {
    changed_paths: ['worker/scripts/deploy-spotify-playcount.mjs'],
    workers: [SPOTIFY],
    commands: ['deploy:spotify-playcount'],
    diagnostics: [],
  });
  assert.deepEqual(select(['worker/scripts/deploy-amazon-music.mjs']), {
    changed_paths: ['worker/scripts/deploy-amazon-music.mjs'],
    workers: [AMAZON],
    commands: ['deploy:amazon-music'],
    diagnostics: [],
  });
  assert.deepEqual(select(['worker/scripts/deploy-runtime.mjs']), {
    changed_paths: ['worker/scripts/deploy-runtime.mjs'],
    workers: [RUNTIME],
    commands: ['deploy:runtime'],
    diagnostics: [RUNTIME],
  });
  assert.deepEqual(select(['worker/scripts/pages-response-kv-namespace.mjs']).workers, [RUNTIME]);
  assert.deepEqual(select(['worker/scripts/verify-runtime-deployment.mjs']).workers, [RUNTIME]);
  assert.deepEqual(select(['worker/scripts/deploy-sakurazaka46jp.mjs']).workers, [SAKURAZAKA]);
  assert.deepEqual(select(['worker/scripts/deploy-nogizaka46smej.mjs']).workers, [NOGIZAKA]);
});

test('MINUTE_DB schema changes deploy the runtime that consumes the schema', () => {
  for (const path of [
    'database/facts-db.json',
    'database/facts-migrations/039_reduce_fact_write_amplification.sql',
    'database/facts-migrations/040_sparse_live_metric_values.sql',
    'database/facts-migrations/041_restore_complete_live_metrics.sql',
  ]) {
    assert.deepEqual(select([path]).workers, [RUNTIME], path);
    assert.deepEqual(select([path]).commands, ['deploy:runtime'], path);
    assert.deepEqual(select([path]).diagnostics, [RUNTIME], path);
  }
});

test('shared deployment infrastructure selects all active Workers', () => {
  for (const path of [
    'worker/package.json',
    'worker/package-lock.json',
    'worker/scripts/cloudflare-build-config.mjs',
    'worker/scripts/cloudflare-queues.mjs',
    'worker/scripts/cloudflare-workers.mjs',
    'worker/scripts/deploy-connected-worker.mjs',
    'worker/scripts/select-worker-deploys.mjs',
    'worker/scripts/wrangler-command.mjs',
  ]) {
    assert.equal(select([path]).workers.length, 8, path);
  }
});

test('Wrangler config changes map directly to their Worker', () => {
  assert.deepEqual(select(['worker/wrangler.sakurazaka46jp.jsonc']).workers, [SAKURAZAKA]);
  assert.deepEqual(select(['worker/wrangler.nogizaka46smej.jsonc']).workers, [NOGIZAKA]);
  assert.deepEqual(select(['worker/wrangler.buddies-recovery.jsonc']).workers, [RECOVERY]);
  assert.deepEqual(select(['worker/wrangler.buddies-collector.jsonc']).workers, [COLLECTOR]);
  assert.deepEqual(select(['worker/wrangler.ohisama-collector.jsonc']).workers, [OHISAMA]);
  assert.deepEqual(select(['worker/wrangler.spotify-playcount.jsonc']).workers, [SPOTIFY]);
  assert.deepEqual(select(['worker/wrangler.amazon-music.jsonc']).workers, [AMAZON]);
  assert.deepEqual(select(['worker/wrangler.runtime.jsonc']).workers, [RUNTIME]);
});

test('tests and unrelated verification scripts do not deploy Workers', () => {
  const result = select([
    'worker/tests/optional-comments.test.js',
    'worker/scripts/verify-facts-live.mjs',
  ]);
  assert.deepEqual(result.workers, []);
  assert.deepEqual(result.commands, []);
});

test('shared package only redeploys importers while unresolved Worker source remains fail-safe', () => {
  assert.equal(select(['packages/sh-shared/index.mjs']).workers.length, 6);
  assert.equal(select(['worker/src/deleted-runtime-module.js']).workers.length, 8);
});

test('manual selection preserves dependency order', () => {
  const result = select([], ['--all']);
  assert.deepEqual(result.workers, ALL_WORKERS);
  assert.deepEqual(result.commands, [
    'deploy:sakurazaka46jp',
    'deploy:nogizaka46smej',
    'deploy:buddies-recovery',
    'deploy:buddies-collector',
    'deploy:ohisama-collector',
    'deploy:spotify-playcount',
    'deploy:amazon-music',
    'deploy:runtime',
  ]);
});
