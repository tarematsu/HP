import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assessSnapshot, auditR2, renderR2Audit, R2_COLLECTION_MAX_AGE_HOURS } from '../.github/scripts/audit-r2-collection-freshness.mjs';
import { collectRegionalR2Snapshot, regionalSnapshotKey } from '../worker/src/regional-music-r2-snapshot.js';
import { buildIssueBody } from '../.github/scripts/publish-cloudflare-observability-status.mjs';
import { resolveObservabilityWorkflowOutcome } from '../.github/scripts/observability-workflow-outcome.mjs';

const now = Date.parse('2026-10-18T01:00:00Z');
function snapshot(service = 'qq_music', age = 0) {
  return { version: 1, service, updated_at: now - age * 3600000,
    state: { service, status: 'ok', last_success_at: now - age * 3600000 }, tracks: [{ service, service_track_id: '123' }] };
}

test('audit accepts the canonical snapshot producer schema', async () => {
  const service = 'qq_music';
  const produced = await collectRegionalR2Snapshot({ service, now, collect: async env => {
    await env.REGIONAL_MUSIC_SNAPSHOT_STORE('tracks', { service, service_track_id: '123', track_id: 1 });
    await env.REGIONAL_MUSIC_SNAPSHOT_STORE('state', { service, status: 'ok', last_success_at: now });
  } });
  assert.equal(assessSnapshot(service, produced, now).status, 'OK');
});

test('cadence respects weekly and weekday schedules and tests both freshness clocks', () => {
  for (const [service, limit] of Object.entries(R2_COLLECTION_MAX_AGE_HOURS)) {
    assert.equal(assessSnapshot(service, snapshot(service, limit), now).status, 'OK');
    assert.equal(assessSnapshot(service, snapshot(service, limit + 1), now).status, 'STALE');
    const freshPublication = snapshot(service, limit + 1);
    freshPublication.updated_at = now;
    assert.equal(assessSnapshot(service, freshPublication, now).status, 'STALE');
  }
  assert.equal(assessSnapshot('qq_music', snapshot('qq_music', 120), now).status, 'OK');
  assert.equal(assessSnapshot('kkbox', snapshot('kkbox', 168), now).status, 'OK');
  assert.equal(assessSnapshot('kugou_music', snapshot('kugou_music', 72), now).status, 'OK');
});

test('missing, failed, malformed and mismatched evidence cannot report healthy', () => {
  for (const mutate of [
    row => { delete row.state.status; }, row => { row.state.status = 'error'; },
    row => { row.state.status = 'degraded'; }, row => { delete row.state.last_success_at; },
    row => { row.state.last_success_at = null; }, row => { row.state.last_success_at = 'bad'; },
    row => { row.updated_at = 0; }, row => { row.updated_at = now + 7200000; },
    row => { row.state.last_success_at = now + 7200000; },
    row => { row.service = 'kkbox'; }, row => { row.state.service = 'kkbox'; },
    row => { row.tracks[0].service = 'kkbox'; }, row => { row.version = 2; },
    row => { delete row.tracks; }, row => { row.tracks = []; },
  ]) {
    const row = snapshot(); mutate(row);
    assert.notEqual(assessSnapshot('qq_music', row, now).status, 'OK');
  }
  for (const stamp of [now / 1000, new Date(now).toISOString()]) {
    const row = snapshot(); row.updated_at = stamp; row.state.last_success_at = stamp;
    assert.equal(assessSnapshot('qq_music', row, now).status, 'OK');
  }
});

test('degraded collector diagnostics include sanitized error details and partial counts', () => {
  const row = snapshot('youtube_music');
  row.state.status = 'degraded';
  row.state.last_error_class = 'collection_error';
  row.state.last_error_message = JSON.stringify([{
    canonical_artist: 'sakurazaka46',
    stage: 'full_songs',
    error: 'YouTube Music browse HTTP 403; Authorization: Bearer secret-token',
  }]);
  row.state.entity_counts = { artists: 3, tracks: 41, failures: 1 };

  const result = assessSnapshot('youtube_music', row, now);
  assert.equal(result.status, 'FAIL');
  assert.match(result.detail, /collector state=degraded/);
  assert.match(result.detail, /class=collection_error/);
  assert.match(result.detail, /YouTube Music browse HTTP 403/);
  assert.match(result.detail, /tracks=41/);
  assert.doesNotMatch(result.detail, /secret-token/);
});

test('R2 reads only configured canonical keys and isolates missing/read/decode failures', async () => {
  const keys = [];
  const rows = await auditR2({ get: async key => {
    keys.push(key);
    if (key.includes('youtube_music')) return null;
    if (key.includes('kkbox')) throw Error('Bearer do-not-publish');
    if (key.includes('kugou_music')) return { json: async () => { throw Error('bad JSON'); } };
    return { json: async () => snapshot() };
  } }, now);
  assert.deepEqual(keys, Object.keys(R2_COLLECTION_MAX_AGE_HOURS).map(regionalSnapshotKey));
  assert.deepEqual(rows.map(row => row.status), ['UNKNOWN', 'OK', 'UNKNOWN', 'UNKNOWN']);
  assert.doesNotMatch(renderR2Audit(rows), /do-not-publish/);
});

const healthy = {
  targetSha: 'current', mainSha: 'current', generatedAt: new Date(now).toISOString(),
  outcomes: { daily: 'success', freeTier: 'success', contract: 'success', d1Insights: 'success', query: 'success', telemetry: 'success', r2Collection: 'success' },
  summaries: { publicHealth: '| Unified health | success | 200 OK |' },
  activeDeployments: { collector: { status: 'active', deployment_id: 'deployment', version_ids: ['version'] } },
};
test('R2 failure, skipped and absent gate fail overall and publish actionable Issue evidence', () => {
  assert.equal(resolveObservabilityWorkflowOutcome(healthy).overall, 'success');
  for (const outcome of ['failure', 'skipped', undefined]) {
    const input = { ...healthy, outcomes: { ...healthy.outcomes, r2Collection: outcome }, summaries: {
      ...healthy.summaries, r2Collection: renderR2Audit([{ service: 'qq_music', status: 'STALE', detail: 'source age 200h' }]),
    } };
    assert.equal(resolveObservabilityWorkflowOutcome(input).overall, 'failure');
    const issue = buildIssueBody(input);
    assert.match(issue, /qq_music — STALE — source age 200h/);
    assert.match(issue, /\[FAIL\] R2 collection freshness/);
    assert.match(issue, /diagnostic-r2-collection/);
  }
});

test('workflow propagates audit exit code and passes gate to both status consumers', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sh-observability.yml', import.meta.url), 'utf8');
  const audit = workflow.split('      - name: Audit R2 collection freshness\n')[1].split('      - name:')[0];
  const script = audit.split('        run: |\n')[1].replace(/^          /gm, '');
  // npm succeeds, audit fails, tee succeeds: the step must retain audit failure.
  const executed = spawnSync('bash', ['-c', `npm() { return 0; }; node() { return 1; }; tee() { cat >/dev/null; }; ${script}`], { encoding: 'utf8' });
  assert.equal(executed.status, 1);
  assert.equal((workflow.match(/R2_COLLECTION_OUTCOME: \$\{\{ steps.r2-collection.outcome \}\}/g) || []).length, 2);
  const publisher = readFileSync(new URL('../.github/scripts/publish-cloudflare-observability-status.mjs', import.meta.url), 'utf8');
  assert.match(publisher, /r2Collection: 'observability\/r2-collection-freshness'/);
});
