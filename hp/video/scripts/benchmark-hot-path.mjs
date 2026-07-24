import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import core from '../src/entry-core.js';

const DEFAULT_OPTIONS = Object.freeze({
  warmup: 500,
  samples: 20,
  iterations: 500
});

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return positiveInteger(argument?.slice(prefix.length), fallback);
}

function createBenchmarkDb(items) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        run() {
          return Promise.resolve({ meta: { changes: 0 } });
        },
        first() {
          if (sql.includes('COUNT(*)')) return Promise.resolve({ count: items.length });
          return Promise.resolve(null);
        },
        all() {
          if (sql.includes('FROM ranking_entries AS ranking')) {
            return Promise.resolve({ results: items });
          }
          return Promise.resolve({ results: [] });
        }
      };
    },
    batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()));
    }
  };
}

function percentile(sorted, ratio) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

export async function runHotPathBenchmark(options = {}) {
  const warmup = positiveInteger(options.warmup, DEFAULT_OPTIONS.warmup);
  const samples = positiveInteger(options.samples, DEFAULT_OPTIONS.samples);
  const iterations = positiveInteger(options.iterations, DEFAULT_OPTIONS.iterations);
  const items = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    mediaUrl: `https://video.twimg.com/ext_tw_video/benchmark/${index + 1}.mp4`
  }));
  const env = {
    ADMIN_TOKEN: 'benchmark-token',
    DB: createBenchmarkDb(items)
  };
  const request = new Request(
    'https://worker.example/api/videos?limit=24&offset=0&seed=1&orientation=both',
    { headers: { authorization: 'Bearer benchmark-token' } }
  );
  const context = { waitUntil() {} };

  for (let index = 0; index < warmup; index += 1) {
    await core.fetch(request, env, context);
  }

  const millisecondsPerInvocation = [];
  let checksum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const response = await core.fetch(request, env, context);
      checksum += response.status;
    }
    millisecondsPerInvocation.push((performance.now() - startedAt) / iterations);
  }

  const sorted = [...millisecondsPerInvocation].sort((left, right) => left - right);
  const meanMs = millisecondsPerInvocation.reduce((sum, value) => sum + value, 0)
    / millisecondsPerInvocation.length;

  return {
    benchmark: 'entry-core warm GET /api/videos response-cache hit',
    runtime: process.version,
    note: 'Directional Node.js timing only; this is not Cloudflare billed CPU time.',
    warmup,
    samples,
    iterationsPerSample: iterations,
    measuredInvocations: samples * iterations,
    checksum,
    millisecondsPerInvocation: {
      mean: meanMs,
      min: sorted[0],
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.at(-1)
    }
  };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const result = await runHotPathBenchmark({
    warmup: option('warmup', DEFAULT_OPTIONS.warmup),
    samples: option('samples', DEFAULT_OPTIONS.samples),
    iterations: option('iterations', DEFAULT_OPTIONS.iterations)
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
