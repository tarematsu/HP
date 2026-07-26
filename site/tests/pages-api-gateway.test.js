import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { apiCatalog, onRequest as catalogRequest } from '../functions/api/index.js';
import { onRequest as healthRequest, readHealth } from '../functions/api/health.js';
import { minuteTaskHealth, readMinuteHealth } from '../functions/lib/health-minute.js';
import { readOtherHealth } from '../functions/lib/health-other.js';
import { readSakurazakaHealth } from '../functions/lib/health-sakurazaka.js';

const NOW = 1_700_000_000_000;
const ACTIVE_MINUTE_TASKS = ['derive', 'recovery', 'rebuild'];
const CANONICAL_PATHS = [
  '/api/health',
  '/api/dashboard',
  '/api/history',
  '/api/track-history',
  '/api/sakurazaka46jp',
  '/api/host-history',
];

function runtimeRow(taskName, overrides = {}) {
  return {
    task_name: taskName,
    last_started_at: NOW - 60_000,
    last_success_at: NOW - 60_000,
    last_failure_at: null,
    last_duration_ms: 25,
    last_error: null,
    runs_total: 10,
    succeeded_total: 10,
    failed_total: 0,
    processed_total: 5,
    job_failures_total: 0,
    last_processed_count: 1,
    last_failed_count: 0,
    pending_count: 0,
    processing_count: 0,
    dead_count: 0,
    oldest_pending_minute: null,
    updated_at: NOW - 60_000,
    ...overrides,
  };
}

function minuteRows() {
  return [
    ...ACTIVE_MINUTE_TASKS.map((task) => runtimeRow(task)),
    runtimeRow('sync', {
      last_started_at: NOW - 24 * 60 * 60_000,
      last_success_at: NOW - 24 * 60 * 60_000,
      failed_total: 10,
      job_failures_total: 10,
    }),
  ];
}

function minuteDb(rows) {
  return {
    prepare(sql) {
      if (sql.includes('MAX(id)')) return { async first() { return { count: 123 }; } };
      if (sql.includes('sh_collector_read_model')) {
        return {
          async first() {
            return {
              last_run_at: NOW - 60_000,
              last_success_at: NOW - 60_000,
              last_error_present: 0,
              updated_at: NOW - 60_000,
            };
          },
        };
      }
      assert.match(sql, /sh_minute_fact_runtime_state/);
      return { async all() { return { results: rows }; } };
    },
  };
}

function otherDb() {
  return {
    prepare(sql) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (sql.includes('FROM sh_collector_status')) {
            assert.equal(this.args[0], 'other-cron');
            return {
              status: 'ok',
              last_attempt_at: NOW - 60_000,
              last_success_at: NOW - 60_000,
              last_error: null,
            };
          }
          if (sql.includes('sh_official_news_monitor_state')) {
            return {
              last_check_at: NOW - 60_000,
              last_success_at: NOW - 60_000,
              last_error: null,
              upcoming_count: 2,
              active_count: 1,
            };
          }
          if (sql.includes('sh_cloud_host_monitor_state')) {
            assert.equal(this.args[0], 'solo:sakurazaka46jp');
            return {
              phase: 'idle',
              session_id: null,
              station_id: null,
              last_success_at: NOW - 60_000,
              last_error: null,
              updated_at: NOW - 60_000,
            };
          }
          throw new Error(`unexpected health SQL: ${sql}`);
        },
      };
    },
  };
}

async function withFixedNow(action) {
  const realDateNow = Date.now;
  Date.now = () => NOW;
  try {
    return await action();
  } finally {
    Date.now = realDateNow;
  }
}

test('Pages API catalog exposes exactly the canonical routes without Worker URLs', async () => {
  const catalog = apiCatalog(NOW);
  assert.equal(catalog.gateway, 'cloudflare-pages');
  assert.equal(catalog.contract_version, 4);
  assert.equal(catalog.worker_urls_public, false);
  const paths = Object.values(catalog.groups).flat().map(({ path }) => path);
  assert.deepEqual(paths, CANONICAL_PATHS);

  const response = await catalogRequest({ request: new Request('https://example.com/api') });
  assert.equal(response.status, 200);
  const rejected = await catalogRequest({ request: new Request('https://example.com/api', { method: 'POST' }) });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET');
});

test('unified Pages health combines all health components behind one URL', async () => {
  const env = {
    MINUTE_DB: minuteDb(minuteRows()),
    OTHER_DB: otherDb(),
    SOLO_BROADCAST_HANDLE: 'sakurazaka46jp',
  };
  const payload = await readHealth(env, NOW);
  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload.components), ['collector', 'minute', 'runtime', 'sakurazaka46jp']);
  assert.equal(payload.components.collector.snapshot_count, 123);
  assert.deepEqual(payload.components.minute.tasks.map(({ task_name: task }) => task), ACTIVE_MINUTE_TASKS);
  assert.equal(payload.components.runtime.ok, true);
  assert.equal(payload.components.sakurazaka46jp.official_news.upcoming_count, 2);

  const response = await withFixedNow(() => healthRequest({
    request: new Request('https://example.com/api/health'),
    env,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).gateway, 'cloudflare-pages');

  const rejected = await healthRequest({
    request: new Request('https://example.com/api/health', { method: 'POST' }),
    env,
  });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET');
});

test('unified health reports individual component failures', async () => {
  const payload = await readHealth({ MINUTE_DB: minuteDb(minuteRows()) }, NOW);
  assert.equal(payload.ok, false);
  assert.equal(payload.components.collector.ok, true);
  assert.equal(payload.components.minute.ok, true);
  assert.equal(payload.components.runtime.ok, false);
  assert.equal(payload.components.sakurazaka46jp.ok, false);
});

test('minute, runtime, and Sakurazaka health preserve component semantics', async () => {
  const minute = await readMinuteHealth({ MINUTE_DB: minuteDb(minuteRows()) }, NOW);
  assert.equal(minute.ok, true);
  assert.deepEqual(minute.tasks.map(({ task_name: task }) => task), ACTIVE_MINUTE_TASKS);

  const unhealthy = minuteTaskHealth(runtimeRow('derive', { dead_count: 1 }), NOW, {});
  assert.equal(unhealthy.ok, false);

  const env = { OTHER_DB: otherDb(), SOLO_BROADCAST_HANDLE: 'sakurazaka46jp' };
  const runtime = await readOtherHealth(env, NOW);
  assert.equal(runtime.ok, true);
  assert.equal(runtime.stale_after_ms, 50 * 60_000);

  const sakurazaka = await readSakurazakaHealth(env, NOW);
  assert.equal(sakurazaka.ok, true);
  assert.equal(sakurazaka.solo_monitor.phase, 'idle');
});

test('minute backlog policy ignores retired sync state and prevents hypersensitive config drift', async () => {
  const oldPending = {
    pending_count: 3,
    oldest_pending_minute: NOW - 60 * 60_000,
  };
  const derive = minuteTaskHealth(runtimeRow('derive', oldPending), NOW, {
    MINUTE_FACT_PENDING_ALERT_COUNT: 1,
    MINUTE_FACT_PENDING_ALERT_MS: 1,
  });
  assert.equal(derive.ok, true);
  assert.equal(derive.backlog_owner, true);
  assert.equal(derive.pending_alert_count, 20);
  assert.equal(derive.pending_alert_ms, 15 * 60_000);
  assert.equal(derive.pending_stale, false);

  const recovery = minuteTaskHealth(runtimeRow('recovery', {
    pending_count: 100,
    dead_count: 4,
    oldest_pending_minute: NOW - 60 * 60_000,
  }), NOW, {});
  assert.equal(recovery.backlog_owner, false);
  assert.equal(recovery.pending_stale, false);
  assert.equal(recovery.ok, true);

  const overloaded = minuteTaskHealth(runtimeRow('derive', {
    pending_count: 20,
    oldest_pending_minute: NOW - 60 * 60_000,
  }), NOW, {});
  assert.equal(overloaded.pending_stale, true);
  assert.equal(overloaded.ok, false);
});

test('only the unified public health Function route exists', () => {
  const configs = [
    '../../worker/wrangler.sakurazaka46jp.jsonc',
    '../../worker/wrangler.runtime.jsonc',
  ].map((path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));

  for (const config of configs) {
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal('route' in config || 'routes' in config, false);
  }

  const pages = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(pages.d1_databases.map(({ binding }) => binding), ['DB', 'MINUTE_DB', 'OTHER_DB']);
  assert.equal(existsSync(new URL('../functions/api/health.js', import.meta.url)), true);

  for (const path of [
    '../functions/api/health/minute.js',
    '../functions/api/health/other.js',
    '../functions/api/health/sakurazaka46jp.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} must not exist`);
  }
});
