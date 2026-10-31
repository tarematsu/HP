import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRecentDays, timestampIssue, leaderboardSourceIssues, spotifyDeltaOutlierIssues, auditPagesData } from '../scripts/pages-data-audit.mjs';
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

test('leaderboard source freshness is checked after Monday publication deadline', () => {
  const mondayBeforeDeadline = Date.parse('2026-10-12T14:00:00Z');
  const tuesday = Date.parse('2026-10-13T14:00:00Z');
  assert.deepEqual(leaderboardSourceIssues({ source_max_ranking_date: '2026-10-05' }, mondayBeforeDeadline), []);
  assert.match(leaderboardSourceIssues({ source_max_ranking_date: '2026-10-05' }, tuesday)[0], /2026-10-12/);
  assert.deepEqual(leaderboardSourceIssues({ source_max_ranking_date: '2026-10-12' }, tuesday), []);
  assert.match(leaderboardSourceIssues({ setup_required: true }, tuesday)[0], /unavailable/);
});

test('Spotify trend audit catches completed-date delta outliers and ignores the in-progress JST day', () => {
  const auditNow = Date.parse('2026-10-28T01:00:00Z'); // 10:00 JST on 2026-10-28
  const issues = spotifyDeltaOutlierIssues({
    trend: {
      nogizaka46: [
        { snapshot_date: '2026-10-24', total_delta: -10_863_630 },
        { snapshot_date: '2026-10-25', total_delta: 11_848_450 },
        { snapshot_date: '2026-10-26', total_delta: 182_370 },
        { snapshot_date: '2026-10-28', total_delta: 12_000_000 },
      ],
    },
  }, auditNow);
  assert.deepEqual(issues, [
    'nogizaka46: daily total delta outlier on 2026-10-24 (-10863630)',
    'nogizaka46: daily total delta outlier on 2026-10-25 (11848450)',
  ]);
});

test('Spotify trend audit rejects nonnumeric aggregate values on completed dates', () => {
  assert.deepEqual(spotifyDeltaOutlierIssues({
    trend: { sakurazaka46: [{ snapshot_date: '2026-10-26', total_delta: 'broken' }] },
  }, Date.parse('2026-10-28T01:00:00Z')), [
    'sakurazaka46: daily total delta is not numeric on 2026-10-26',
  ]);
});

test('collector degradation includes sanitized failure details without exposing URLs or tokens', async () => {
  const report = await auditPagesData(async (path) => {
    if (path === '/api/youtube-music') {
      return {
        services: [{
          status: 'degraded',
          last_success_at: now,
          last_error_class: 'collection_error',
          last_error_message: JSON.stringify([{
            canonical_artist: 'sakurazaka46',
            stage: 'full_songs',
            error: 'HTTP 429 https://music.youtube.com/youtubei/v1/browse?key=secret-token',
          }]),
        }],
      };
    }
    throw new Error('HTTP 503');
  }, now);
  const youtube = report.checks.find((row) => row.name === 'youtube-music');
  assert.equal(youtube.ok, false);
  assert.match(youtube.issues.join(' '), /sakurazaka46/);
  assert.match(youtube.issues.join(' '), /full_songs/);
  assert.match(youtube.issues.join(' '), /HTTP 429/);
  assert.match(youtube.issues.join(' '), /\\[url\\]/);
  assert.doesNotMatch(youtube.issues.join(' '), /music\\.youtube\\.com|secret-token/);
});
