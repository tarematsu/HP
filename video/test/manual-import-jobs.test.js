import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  enqueueManualImportJob,
  failManualImportJob,
  MANUAL_IMPORT_CHUNK_SIZE,
  MANUAL_IMPORT_SYNC_LIMIT,
  readManualImportJob
} from '../src/manual-import-jobs.js';

class Statement {
  constructor(sql) {
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return null;
  }
}

class CaptureDb {
  constructor(row = null) {
    this.row = row;
    this.batches = [];
  }

  prepare(sql) {
    const statement = new Statement(sql);
    statement.first = async () => this.row;
    return statement;
  }

  async batch(statements) {
    this.batches.push(statements);
    return statements.map(() => ({ results: [], meta: { changes: 1 } }));
  }
}

test('maximum manual import is split by one D1 JSON statement', async () => {
  const db = new CaptureDb();
  const urls = Array.from({ length: 300 }, (_, index) => `https://cdn.example/${index}.mp4`);
  const job = await enqueueManualImportJob(db, {
    jobId: '00000000-0000-4000-8000-000000000001',
    sourceUrl: 'https://example.com/source',
    urls,
    createdAt: '2026-07-19T00:00:00.000Z'
  });

  assert.equal(MANUAL_IMPORT_CHUNK_SIZE, 20);
  assert.equal(MANUAL_IMPORT_SYNC_LIMIT, 20);
  assert.equal(job.totalChunks, 15);
  assert.equal(job.totalUrls, 300);
  assert.equal(db.batches.length, 1);

  const statements = db.batches[0];
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /^INSERT INTO manual_import_jobs/);
  assert.deepEqual(statements[0].args.slice(0, 4), [
    job.jobId,
    'https://example.com/source',
    300,
    15
  ]);

  assert.match(statements[1].sql, /FROM json_each\(\?\)/);
  assert.match(statements[1].sql, /json_group_array\(url\)/);
  assert.match(statements[1].sql, /INSERT INTO manual_import_job_chunks/);
  assert.equal(statements[1].args[0], JSON.stringify(urls));
  assert.deepEqual(statements[1].args.slice(1), [20, 20, job.jobId]);
});

test('Queue publication failure marks the D1 job failed and removes stored chunks', async () => {
  const db = new CaptureDb();
  await failManualImportJob(
    db,
    '00000000-0000-4000-8000-000000000003',
    new Error('queue unavailable'),
    '2026-07-19T00:03:00.000Z'
  );

  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  assert.match(db.batches[0][0].sql, /SET status = 'failed'/);
  assert.match(db.batches[0][0].sql, /failure_count = MAX\(failure_count, \?\)/);
  assert.match(db.batches[0][1].sql, /DELETE FROM manual_import_job_chunks/);
});

test('job status excludes stored URL payloads', async () => {
  const db = new CaptureDb({
    jobId: '00000000-0000-4000-8000-000000000002',
    totalUrls: 41,
    totalChunks: 3,
    nextChunk: 2,
    importedCount: 40,
    insertedCount: 10,
    changedCount: 12,
    failureCount: 1,
    combinedFeedCount: null,
    status: 'pending',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:02:00.000Z',
    completedAt: null,
    lastError: null
  });
  const status = await readManualImportJob(db, '00000000-0000-4000-8000-000000000002');

  assert.equal(status.completedChunks, 2);
  assert.equal(status.totalChunks, 3);
  assert.equal(status.imported, 40);
  assert.equal(status.failures, 1);
  assert.equal('urlsJson' in status, false);
  assert.equal('sourceUrl' in status, false);
});

test('large imports use Queue chaining while preserving D1 finalization state', async () => {
  const manualImport = await readFile(new URL('../src/manual-import.js', import.meta.url), 'utf8');
  const jobs = await readFile(new URL('../src/manual-import-jobs.js', import.meta.url), 'utf8');
  const entryCore = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');
  const queue = await readFile(new URL('../src/manual-import-queue.js', import.meta.url), 'utf8');
  const standaloneWrangler = JSON.parse(await readFile(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8'
  ));
  const unifiedWrangler = JSON.parse(await readFile(
    new URL('../../cloud/wrangler.jsonc', import.meta.url),
    'utf8'
  ));
  const migration = await readFile(
    new URL('../migrations/100000_manual_import_jobs.sql', import.meta.url),
    'utf8'
  );
  const limitMigration = await readFile(
    new URL('../migrations/100001_manual_import_limit.sql', import.meta.url),
    'utf8'
  );

  assert.match(manualImport, /body\.urls\.length > MANUAL_IMPORT_SYNC_LIMIT/);
  assert.match(manualImport, /MANUAL_IMPORT_MAX_URLS/);
  assert.match(manualImport, /publishManualImportJob\(env, job\.jobId\)/);
  assert.match(manualImport, /status: 202/);
  assert.match(manualImport, /status: 503/);
  assert.equal(typeof failManualImportJob, 'function');
  assert.match(jobs, /function acquiredJobFields\(\)/);
  assert.match(jobs, /targetJobId = String\(options\.jobId \|\| ''\)/);
  assert.match(jobs, /jobId: options\.jobId/);
  assert.match(jobs, /RETURNING \$\{acquiredJobFields\(\)\}/);
  assert.match(jobs, /changed_count \+ \? = 0 THEN 'completed'/);
  assert.match(jobs, /WHEN next_chunk \+ 1 >= total_chunks THEN 'finalizing'/);
  assert.match(jobs, /SELECT row_count FROM playback_feed_state WHERE id = 1/);
  assert.match(jobs, /if \(row\.status === 'completed'\)/);
  assert.match(jobs, /completed: advanced\.status === 'completed'/);
  assert.match(jobs, /if \(job\.status === 'finalizing'\)/);
  assert.match(jobs, /return await finalizeJob\(env, job, acquiredAt\)/);
  assert.match(jobs, /if \(number\(job\.changedCount\) > 0\) return finalizeCompactedFeed\(env\)/);
  assert.match(jobs, /readFeedState\(env\.DB\)/);
  assert.match(jobs, /const MAX_FAILURES = 3/);
  assert.match(jobs, /failure_count \+ 1 >= \?/);
  assert.match(jobs, /DELETE FROM manual_import_job_chunks WHERE job_id = \?/);
  assert.match(jobs, /isPlaybackFeedFinalizationBusy\(error\)/);
  assert.match(jobs, /releaseBusyFinalization\(env\.DB, job, acquiredAt\)/);
  assert.match(jobs, /deferred: true/);
  assert.match(jobs, /AND status = 'finalizing'/);
  assert.match(entryCore, /async queue\(batch, env\)/);
  assert.match(entryCore, /consumeManualImportBatch\(batch, env\)/);
  assert.doesNotMatch(entryCore, /scheduled-manual-import/);
  assert.match(queue, /dependencies\.runJob \|\| runManualImportJobChunk/);
  assert.match(queue, /runJob\(env, \{ jobId \}\)/);
  assert.match(queue, /publishManualImportJob/);
  assert.match(queue, /publish\(env, jobId/);
  assert.match(entryCore, /ADMIN_IMPORT_JOB_PATH_PREFIX/);
  assert.equal(standaloneWrangler.triggers, undefined);
  assert.equal(standaloneWrangler.queues, undefined);
  assert.equal(unifiedWrangler.triggers, undefined);
  assert.equal(unifiedWrangler.queues.producers[0].binding, 'MANUAL_IMPORT_QUEUE');
  assert.equal(unifiedWrangler.queues.consumers[0].max_batch_size, 1);
  assert.equal(unifiedWrangler.queues.consumers[0].max_concurrency, 1);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manual_import_job_chunks/);
  assert.match(migration, /failure_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /url_count INTEGER/);
  assert.match(migration, /url_count > 0 AND url_count <= 20/);
  assert.match(limitMigration, /NEW\.total_urls > 300/);
  assert.match(limitMigration, /BEFORE INSERT ON manual_import_jobs/);
  assert.match(limitMigration, /BEFORE UPDATE OF total_urls ON manual_import_jobs/);
});
