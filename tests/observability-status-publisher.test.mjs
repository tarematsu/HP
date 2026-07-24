import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_ISSUE_BODY_CHARS,
  MAX_SECTION_CHARS,
  clipText,
  normalizeOutcome,
  overallOutcome,
  publishCommitStatuses,
  sanitizeText,
  statusState,
  upsertStatusIssue,
} from '../.github/scripts/observability-status-publisher.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('shared publisher normalizes failures and sanitizes diagnostic text', () => {
  assert.equal(MAX_SECTION_CHARS, 12_000);
  assert.equal(MAX_ISSUE_BODY_CHARS, 60_000);
  assert.equal(normalizeOutcome(' CANCELLED '), 'cancelled');
  assert.equal(normalizeOutcome('unexpected'), 'unknown');
  assert.equal(statusState('success'), 'success');
  assert.equal(statusState('skipped'), 'failure');
  assert.equal(overallOutcome({ a: 'success', b: 'success' }), 'success');
  assert.equal(overallOutcome({ a: 'success', b: 'unknown' }), 'failure');

  const sanitized = sanitizeText(
    'Authorization: Bearer secret-value https://example.test/?token=abc CLOUDFLARE_ACCOUNT_ID=123',
  );
  assert.doesNotMatch(sanitized, /secret-value|token=abc|ACCOUNT_ID=123/);
  assert.match(sanitized, /Bearer \[redacted\]/);
  assert.match(sanitized, /token=\[redacted\]/);
  assert.match(sanitized, /CLOUDFLARE_ACCOUNT_ID=\[redacted\]/);
  assert.match(clipText('x'.repeat(20), 10), /^x{10}\n\n…truncated…$/);
});

test('shared publisher emits component and overall commit statuses', async () => {
  const calls = [];
  const request = async (...args) => {
    calls.push(args);
    return {};
  };
  await publishCommitStatuses({
    request,
    targetSha: 'abc/123',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    outcomes: { policy: 'success', query: 'skipped' },
    contexts: {
      policy: 'observability/policy',
      query: 'observability/query',
    },
    overallDescription: 'Observability',
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0][1], '/statuses/abc%2F123');
  assert.deepEqual(calls.map(([, , payload]) => payload.state), ['success', 'failure', 'failure']);
  assert.equal(calls.at(-1)[2].context, 'observability/overall');
});

test('shared publisher reopens an existing status issue or creates one', async () => {
  const updated = [];
  const updateRequest = async (method, path, payload) => {
    updated.push([method, path, payload]);
    if (method === 'GET') {
      return [{ number: 42, title: 'Status', body: '<!-- marker -->', state: 'closed' }];
    }
    return { number: 42 };
  };
  const existing = await upsertStatusIssue({
    request: updateRequest,
    title: 'Status',
    marker: '<!-- marker -->',
    body: 'new body',
  });
  assert.equal(existing.number, 42);
  assert.deepEqual(updated[1], [
    'PATCH',
    '/issues/42',
    { title: 'Status', body: 'new body', state: 'open' },
  ]);

  const created = [];
  const createRequest = async (method, path, payload) => {
    created.push([method, path, payload]);
    return method === 'GET' ? [] : { number: 43 };
  };
  const issue = await upsertStatusIssue({
    request: createRequest,
    title: 'Status',
    marker: '<!-- marker -->',
    body: 'body',
  });
  assert.equal(issue.number, 43);
  assert.deepEqual(created[1], ['POST', '/issues', { title: 'Status', body: 'body' }]);
});

test('all observability validation workflows track the shared publisher', () => {
  for (const path of [
    '.github/workflows/sh-observability.yml',
    '.github/workflows/hp-observability.yml',
    '.github/workflows/homepanel-unified-ci.yml',
  ]) {
    assert.match(
      read(path),
      /^\s{6}- '\.github\/scripts\/observability-status-publisher\.mjs'$/m,
      path,
    );
  }
});
