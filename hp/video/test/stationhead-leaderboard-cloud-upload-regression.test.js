import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const probeScript = read('../../native/src/sh_july19_stats_policy_fix.h');
const messagePolicy = read('../../native/src/sh_leaderboard_probe_message_policy.h');
const spool = read('../../native/src/stationhead_leaderboard_probe_spool.h');
const appMessages = read('../../native/src/app_messages.cpp');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const cloudPayload = read('../../cloud/src/device_exchange_payload.ts');
const cloudProbe = read('../../cloud/src/stationhead_leaderboard_probe.ts');
const cloudProbeStatus = read('../../cloud/src/stationhead_leaderboard_probe_status.ts');
const unifiedWorker = read('../../cloud/src/unified_worker.js');
const reportWorkflow = read('../../../.github/workflows/stationhead-leaderboard-probe-report.yml');

test('leaderboard probe sends only bounded data records to the native trusted-origin bridge', () => {
  assert.match(probeScript, /stationhead-leaderboard-probe:' \+ JSON\.stringify\(safe\)/);
  assert.match(probeScript, /body: String\(row\.body \|\| ''\)\.slice\(0, 65536\)/);
  assert.doesNotMatch(probeScript, /JSON\.stringify\(window\.__homepanelStationheadAuthHeaders\)/);
  assert.match(messagePolicy, /IsTrustedStationheadSource/);
  assert.match(messagePolicy, /CaptureProbeMessage/);
  assert.match(messagePolicy, /stationhead_leaderboard_probe_spool::Append/);
});

test('native probe spool is durable, bounded, and wakes the existing cloud client', () => {
  assert.match(spool, /stationhead-leaderboard-probe\.ndjson/);
  assert.match(spool, /kMaxProbeRecords = 20/);
  assert.match(spool, /kProbeUploadBatchSize = 8/);
  assert.match(spool, /inline size_t Count\(\)/);
  assert.match(spool, /MoveFileExW[\s\S]*MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  assert.match(appMessages, /case kStationheadLeaderboardProbeWakeMessage:[\s\S]*cloud_->RefreshNow\(\)/);
});

test('device exchange uploads probe records and non-secret diagnostics separately from sensor telemetry', () => {
  assert.match(exchange, /stationhead_leaderboard_probe_spool::ReadBatch\(\)/);
  assert.match(exchange, /stationhead_leaderboard_probe_spool::Count\(\)/);
  assert.match(exchange, /,\\"leaderboardProbe\\":\[/);
  assert.match(exchange, /,\\"leaderboardProbeStatus\\":\{\\"spoolRecords\\":/);
  assert.match(exchange, /GetNamedBoolean\(L"reported", false\)/);
  assert.match(exchange, /stationhead_leaderboard_probe_spool::Acknowledge\(accepted\)/);
  assert.match(cloudPayload, /leaderboardProbe\?: unknown/);
  assert.match(cloudPayload, /leaderboardProbeStatus\?: unknown/);
  assert.match(cloudPayload, /applyStationheadLeaderboardProbeInput/);
  assert.match(cloudPayload, /applyNativeLeaderboardProbeStatus/);
});

test('public leaderboard diagnostics expose only bounded operational state', () => {
  assert.match(cloudProbeStatus, /diagnostics\/stationhead-leaderboard\/status\.json/);
  assert.match(cloudProbeStatus, /spool_records/);
  assert.match(cloudProbeStatus, /batch_records/);
  assert.match(cloudProbeStatus, /last_probe_received_at/);
  assert.match(cloudProbeStatus, /last_stored_at/);
  assert.match(cloudProbeStatus, /last_reported_at/);
  assert.doesNotMatch(cloudProbeStatus, /device_id/);
  assert.doesNotMatch(cloudProbeStatus, /authorization|cookie|Bearer/i);
  assert.match(unifiedWorker, /\/api\/health\/stationhead-leaderboard-probe/);
  assert.match(unifiedWorker, /stationheadLeaderboardProbeStatusResponse\(env\)/);
});

test('cloud keeps full redacted history in R2 and reports bounded nested artifact data without logging bodies', () => {
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/history\//);
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/latest\.json/);
  assert.match(cloudProbe, /SECRET_KEY/);
  assert.match(cloudProbe, /MAX_REPORT_BODY_CHARS = 24_576/);
  assert.match(cloudProbe, /MAX_REPORT_PREVIEW_CHARS = 768/);
  assert.match(cloudProbe, /candidates: records\.map/);
  assert.match(cloudProbe, /best: \{/);
  assert.match(cloudProbe, /event_type: "stationhead-leaderboard-probe"/);
  assert.match(reportWorkflow, /actions\/upload-artifact@v4/);
  assert.match(reportWorkflow, /Response bodies and candidate previews are intentionally omitted from logs/);
  assert.doesNotMatch(reportWorkflow, /summary\.write\([^\n]*best\.get\("body"/);
});
