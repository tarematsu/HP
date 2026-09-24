import { performance } from 'node:perf_hooks';
import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
const now = Date.now();
const cached = new Response('{}', { headers: { 'x-materialized-at': String(now) } });
const dependencies = {
  now: () => now,
  cache: { match: async () => cached },
};

for (let i = 0; i < 1000; i += 1) await runPagesResponseFetch(request, {}, dependencies);
const iterations = 10000;
const started = performance.now();
for (let i = 0; i < iterations; i += 1) await runPagesResponseFetch(request, {}, dependencies);
const elapsed = performance.now() - started;
console.log(JSON.stringify({
  benchmark: 'Pages internal response edge-cache hit',
  iterations,
  elapsed_ms: elapsed,
  milliseconds_per_invocation: elapsed / iterations,
}));
