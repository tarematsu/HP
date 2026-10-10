import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRecentDays, timestampIssue, auditPagesData } from '../scripts/pages-data-audit.mjs';
const now = Date.parse('2026-10-10T16:00:00Z');
test('daily audit respects UTC closure and detects internal missing dates', () => {
  assert.deepEqual(missingRecentDays(['2026-10-06', '2026-10-08', '2026-10-09'], now), ['2026-10-07']);
  assert.deepEqual(missingRecentDays(['2026-10-08'], Date.parse('2026-10-10T00:05:00Z')), []);
});
test('republishing cannot make an old provider observation fresh', () => {
  assert.match(timestampIssue(now - 8 * 86_400_000, now, 36 * 3_600_000), /stale/);
  assert.match(timestampIssue(null, now, 1000), /missing/);
  assert.match(timestampIssue(now + 600_000, now, 1000), /future/);
});
test('HTTP failures remain separate data failures rather than successful screenshots', async () => {
  const report = await auditPagesData(async () => { throw new Error('HTTP 503'); }, now);
  assert.equal(report.ok, false);
  assert.ok(report.failed_count > 10);
  assert.ok(report.checks.every((row) => row.issues[0] === 'HTTP 503'));
});

test('fresh partial collection remains a data failure', async () => {
  const report = await auditPagesData(async () => ({
    source_updated_at: now,
    services: [{ status: 'degraded', last_success_at: now }],
  }), now);
  const youtube = report.checks.find(row => row.name === 'youtube-music');
  assert.equal(youtube.ok, false);
  assert.deepEqual(youtube.issues, ['collector status: degraded']);
});
