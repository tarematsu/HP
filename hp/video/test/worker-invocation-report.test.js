import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInvocationMarkdown,
  isObservabilityAuthorizationError,
  percentile,
  safeInvocationTrigger,
  summarizeInvocations,
  telemetryQueryBody
} from '../scripts/report-worker-invocations.mjs';

test('telemetry query filters invocation events to one Worker and CPU-bearing rows', () => {
  const body = telemetryQueryBody({
    workerName: 'videoscraper',
    from: 1_000,
    to: 2_000,
    limit: 500,
    offset: 'cursor-1',
    queryId: 'test-query'
  });

  assert.equal(body.queryId, 'test-query');
  assert.deepEqual(body.timeframe, { from: 1_000, to: 2_000 });
  assert.equal(body.limit, 500);
  assert.equal(body.offset, 'cursor-1');
  assert.equal(body.offsetDirection, 'next');
  assert.equal(body.parameters.view, 'events');
  assert.deepEqual(body.parameters.datasets, ['cloudflare-workers']);
  assert.deepEqual(body.parameters.filters, [
    {
      key: '$workers.scriptName',
      operation: 'eq',
      type: 'string',
      value: 'videoscraper'
    },
    {
      key: '$workers.cpuTimeMs',
      operation: 'exists',
      type: 'number'
    }
  ]);
});

test('trigger sanitization strips query strings and bounds artifact text', () => {
  assert.equal(safeInvocationTrigger('GET /api/videos?token=secret'), 'GET /api/videos');
  assert.ok(safeInvocationTrigger('x'.repeat(500)).length <= 160);
});

test('nearest-rank percentiles are calculated over returned invocation values', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  assert.equal(percentile([], 0.99), null);
});

test('invocations are summarized independently by event type and target', () => {
  const summary = summarizeInvocations([
    { eventType: 'scheduled', cpuTimeMs: 5, requestId: 'a' },
    { eventType: 'scheduled', cpuTimeMs: 12, requestId: 'b' },
    { eventType: 'fetch', cpuTimeMs: 2, requestId: 'c' },
    { eventType: 'queue', cpuTimeMs: 18, requestId: 'd' }
  ], { targetMs: 10 });

  assert.equal(summary.returnedInvocations, 4);
  assert.equal(summary.aboveTargetCount, 2);
  assert.equal(summary.eventTypes.scheduled.count, 2);
  assert.equal(summary.eventTypes.scheduled.aboveTarget, 1);
  assert.equal(summary.eventTypes.scheduled.maxMs, 12);
  assert.equal(summary.eventTypes.fetch.maxMs, 2);
  assert.equal(summary.eventTypes.queue.maxMs, 18);
  assert.deepEqual(summary.aboveTarget.map((row) => row.requestId), ['d', 'b']);
});

test('markdown states returned-set and sampling limitations', () => {
  const summary = summarizeInvocations([], { targetMs: 10 });
  const markdown = buildInvocationMarkdown({
    workerName: 'videoscraper',
    datetimeStart: '2026-07-19T00:00:00.000Z',
    datetimeEnd: '2026-07-19T06:00:00.000Z',
    matchedEvents: 0,
    abrLevel: 2,
    truncated: false,
    summary
  });

  assert.match(markdown, /Cloudflare ABR sampling level: 2/);
  assert.match(markdown, /Returned invocations above target: 0/);
  assert.match(markdown, /None in the returned event set/);
  assert.match(markdown, /not complete coverage/);
});


test('Observability authorization errors are classified without hiding other failures', () => {
  assert.equal(
    isObservabilityAuthorizationError(new Error('Cloudflare API 403: 10000:Authentication error')),
    true
  );
  assert.equal(isObservabilityAuthorizationError(new Error('Cloudflare API 400: bad filter')), false);
});

test('unavailable telemetry report names the missing permission and makes no CPU claim', () => {
  const summary = summarizeInvocations([], { targetMs: 10 });
  const markdown = buildInvocationMarkdown({
    available: false,
    unavailableReason: 'configured token lacks Workers Observability Write permission',
    workerName: 'videoscraper',
    datetimeStart: '2026-07-19T00:00:00.000Z',
    datetimeEnd: '2026-07-19T06:00:00.000Z',
    summary
  });

  assert.match(markdown, /Exact invocation telemetry: unavailable/);
  assert.match(markdown, /Workers Observability Write/);
  assert.match(markdown, /No per-event-type or over-target invocation claim/);
  assert.doesNotMatch(markdown, /P99:/);
});
