import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const url = relative => new URL(relative, import.meta.url);
const read = relative => readFileSync(url(relative), 'utf8');
const playbackPolicy = read('../../native/src/sh_july19_stats_policy_fix.h');
const messagePolicy = read('../../native/src/sh_stats_webview_message_policy_fix.h');
const collector = read('../../native/src/stationhead_leaderboard_collector.cpp');
const collectorHeader = read('../../native/src/stationhead_leaderboard_collector.h');
const diagnostics = read('../../native/src/stationhead_leaderboard_diagnostics.h');
const spool = read('../../native/src/stationhead_leaderboard_capture_spool.h');
const app = read('../../native/src/app.cpp');
const appMessages = read('../../native/src/app_messages.cpp');
const cmake = read('../../native/CMakeLists.txt');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const cloudPayload = read('../../cloud/src/device_exchange_payload.ts');
const cloudProbe = read('../../cloud/src/stationhead_leaderboard_probe.ts');
const cloudProbeStatus = read('../../cloud/src/stationhead_leaderboard_probe_status.ts');
const unifiedWorker = read('../../cloud/src/unified_worker.js');
const reportWorkflow = read('../../../.github/workflows/stationhead-leaderboard-probe-report.yml');

test('legacy leaderboard interception is completely absent from playback WebViews', () => {
  assert.doesNotMatch(playbackPolicy, /StationheadJuly19LeaderboardProbeScript/);
  assert.doesNotMatch(playbackPolicy, /__homepanelLeaderboardProbeInstalled/);
  assert.doesNotMatch(playbackPolicy, /homepanel_probe|__hpLeaderboardProbe/);
  assert.doesNotMatch(playbackPolicy, /stationhead-leaderboard-probe:/);
  assert.doesNotMatch(messagePolicy, /leaderboard_probe|LeaderboardProbe/);
  assert.equal(existsSync(url('../../native/src/sh_leaderboard_probe_message_policy.h')), false);
  assert.equal(existsSync(url('../../native/src/stationhead_leaderboard_probe_spool.h')), false);
  assert.match(playbackPolicy, /StationheadJuly19AuthCaptureScript/);
  assert.match(playbackPolicy, /StationheadLoginSettlementScript/);
});

test('leaderboard acquisition keeps one 1x1 background WebView active and waits for rendered ranking data', () => {
  assert.match(collector, /https:\/\/www\.stationhead\.com\/leaderboard/);
  assert.match(collector, /about:blank/);
  assert.match(collector, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.match(collector, /put_ProfileName\(profileName_\.c_str\(\)\)/);
  assert.match(collector, /put_IsInPrivateModeEnabled\(FALSE\)/);
  assert.match(collector, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(collector, /RECT bounds\{0, 0, 1, 1\}/);
  assert.match(collector, /put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(collector, /put_IsVisible\(FALSE\)/);
  assert.match(collector, /add_NavigationCompleted/);
  assert.match(collector, /NavigateCurrent\(generation_\)/);
  assert.match(collectorHeader, /void NavigateCurrent\(uint64_t generation\)/);
  assert.match(collector, /kCaptureTimeoutMs = 90'000/);
  assert.match(collector, /kContentPollIntervalMs = 2'000/);
  assert.match(collector, /ExecuteScript/);
  assert.match(collector, /document\.querySelectorAll\('tr,\[role="row"\]'\)/);
  assert.match(collector, /signed_in/);
  assert.match(collector, /leaderboard_ready/);
  assert.match(collector, /lines\.length >= 10 && links\.length >= 5/);
  assert.match(collector, /GetNamedBoolean\(L"leaderboard_ready", !signedIn\)/);
  assert.match(collector, /captureDueAt_ = now \+ kContentPollIntervalMs/);
  assert.match(collector, /resource_paths/);
  assert.match(collector, /CloseController\(\)/);
  assert.match(collectorHeader, /NextWakeAt\(\) const noexcept/);
  assert.match(cmake, /src\/stationhead_leaderboard_collector\.cpp/);

  const navigateStart = collector.indexOf('void StationheadLeaderboardCollector::NavigateCurrent');
  const snapshotStart = collector.indexOf('void StationheadLeaderboardCollector::CaptureSnapshot');
  assert.ok(navigateStart >= 0 && snapshotStart > navigateStart);
  const navigateBody = collector.slice(navigateStart, snapshotStart);
  assert.match(navigateBody, /webview_->Navigate\(kLeaderboardUrl\)/);
  assert.match(navigateBody, /captureDueAt_ = now \+ kRenderSettleMs/);
  assert.match(navigateBody, /UpdateNextWake\(\)/);

  const completeStart = collector.indexOf('void StationheadLeaderboardCollector::CompleteCapture');
  const failStart = collector.indexOf('void StationheadLeaderboardCollector::FailCapture');
  assert.ok(completeStart >= 0 && failStart > completeStart);
  const snapshotBody = collector.slice(snapshotStart, completeStart);
  assert.match(snapshotBody, /FAILED\(result\)[\s\S]*captureDueAt_ = now \+ kContentPollIntervalMs/);
  assert.match(snapshotBody, /FAILED\(execute\)[\s\S]*captureDueAt_ = nowMs \+ kContentPollIntervalMs/);
  const completeBody = collector.slice(completeStart, failStart);
  assert.doesNotMatch(completeBody, /CloseController\(\)/);
  assert.match(completeBody, /webview_->Navigate\(kIdleUrl\)/);

  const failBody = collector.slice(failStart, collector.indexOf('void StationheadLeaderboardCollector::CloseController'));
  assert.match(failBody, /\+\+generation_/);
  assert.match(failBody, /CloseController\(\)/);
  assert.match(failBody, /environment_\.Reset\(\)/);

  assert.match(app, /StationheadLeaderboardCollector>[\s\S]*kStationheadOzekiProfile/);
  const stationheadStart = app.indexOf('stationhead_->Start();');
  const collectorStart = app.indexOf('stationheadLeaderboardCollector_->Start(now);');
  assert.ok(stationheadStart >= 0 && collectorStart > stationheadStart);
  assert.match(app, /stationheadLeaderboardCollector_->Tick\(now\)/);
  assert.match(app, /stationheadLeaderboardCollector_->NextWakeAt\(\)/);
  assert.match(app, /stationheadLeaderboardCollector_->Stop\(\)/);
});

test('native leaderboard diagnostics expose categorical collector progress only', () => {
  assert.match(diagnostics, /kDiagnosticSchema = 2/);
  assert.match(diagnostics, /std::string stage = "bootstrap"/);
  assert.match(diagnostics, /std::string lastSuccessStage = "bootstrap"/);
  assert.match(diagnostics, /std::string lastError = "none"/);
  assert.match(diagnostics, /MarkTick\(\)/);
  assert.match(diagnostics, /ErrorCategory/);
  assert.doesNotMatch(diagnostics, /authorization|cookie|Bearer/i);

  for (const stage of [
    'constructed',
    'started',
    'capture_begin',
    'environment_ready',
    'controller_ready',
    'webview_ready',
    'navigating',
    'navigation_completed',
    'snapshot_started',
    'snapshot_parsed',
    'spool_stored',
    'completed',
  ]) {
    assert.match(collector, new RegExp(`Mark\\(\\s*\"${stage}\"`));
  }
  assert.match(collector, /MarkTick\(\)/);
  assert.match(collector, /MarkFailure\([\s\S]*ErrorCategory/);
});

test('leaderboard wake channel rearms the app scheduler and cloud upload', () => {
  assert.match(diagnostics, /kWakeMessage = WM_APP \+ 31/);
  assert.match(spool, /kStationheadLeaderboardCaptureWakeMessage = WM_APP \+ 31/);
  assert.match(diagnostics, /PostMessageW\(window, kWakeMessage, 0, 0\)/);

  const wakeCaseStart = appMessages.indexOf('case kStationheadLeaderboardCaptureWakeMessage:');
  const nextCaseStart = appMessages.indexOf('case WM_HP_PRIMARY_RELOAD_READY:', wakeCaseStart);
  assert.ok(wakeCaseStart >= 0 && nextCaseStart > wakeCaseStart);
  const wakeCase = appMessages.slice(wakeCaseStart, nextCaseStart);
  assert.match(wakeCase, /ScheduleNextTick\(1\)/);
  assert.match(wakeCase, /cloud_->RefreshNow\(\)/);
});

test('new native capture spool is durable, bounded, wakes cloud, and deletes legacy disk state', () => {
  assert.match(spool, /stationhead-leaderboard-capture\.ndjson/);
  assert.match(spool, /stationhead-leaderboard-probe\.ndjson/);
  assert.match(spool, /RemoveLegacyProbeSpool/);
  assert.match(spool, /kMaxCaptureRecords = 20/);
  assert.match(spool, /kCaptureUploadBatchSize = 8/);
  assert.match(spool, /inline size_t Count\(\)/);
  assert.match(spool, /MoveFileExW[\s\S]*MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
});

test('device exchange preserves the secure Cloud wire contract with the rebuilt capture spool', () => {
  assert.match(exchange, /stationhead_leaderboard_capture_spool::ReadBatch\(\)/);
  assert.match(exchange, /stationhead_leaderboard_capture_spool::Count\(\)/);
  assert.match(exchange, /stationhead_leaderboard_diagnostics::Read\(\)/);
  assert.match(exchange, /,\\"leaderboardProbe\\":\[/);
  assert.match(exchange, /,\\"leaderboardProbeStatus\\":\{\\"spoolRecords\\":/);
  assert.match(exchange, /\\"diagnosticSchema\\"/);
  assert.match(exchange, /\\"collectorStage\\"/);
  assert.match(exchange, /\\"lastSuccessStage\\"/);
  assert.match(exchange, /\\"collectorStarted\\"/);
  assert.match(exchange, /\\"collectorTicked\\"/);
  assert.match(exchange, /\\"lastError\\"/);
  assert.match(exchange, /GetNamedBoolean\(L"reported", false\)/);
  assert.match(exchange, /stationhead_leaderboard_capture_spool::Acknowledge\(leaderboardCapture, accepted\)/);
  assert.match(cloudPayload, /leaderboardProbe\?: unknown/);
  assert.match(cloudPayload, /leaderboardProbeStatus\?: unknown/);
  assert.match(cloudPayload, /applyStationheadLeaderboardProbeInput/);
  assert.match(cloudPayload, /applyNativeLeaderboardProbeStatus/);
});

test('public leaderboard diagnostics expose only bounded operational state', () => {
  assert.match(cloudProbeStatus, /diagnostics\/stationhead-leaderboard\/status\.json/);
  assert.match(cloudProbeStatus, /spool_records/);
  assert.match(cloudProbeStatus, /batch_records/);
  assert.match(cloudProbeStatus, /diagnostic_schema/);
  assert.match(cloudProbeStatus, /collector_stage/);
  assert.match(cloudProbeStatus, /last_success_stage/);
  assert.match(cloudProbeStatus, /collector_started/);
  assert.match(cloudProbeStatus, /collector_ticked/);
  assert.match(cloudProbeStatus, /last_error/);
  assert.match(cloudProbeStatus, /last_probe_received_at/);
  assert.match(cloudProbeStatus, /last_stored_at/);
  assert.match(cloudProbeStatus, /last_reported_at/);
  assert.doesNotMatch(cloudProbeStatus, /device_id/);
  assert.doesNotMatch(cloudProbeStatus, /authorization|cookie|Bearer/i);
  assert.match(unifiedWorker, /\/api\/health\/stationhead-leaderboard-probe/);
  assert.match(unifiedWorker, /stationheadLeaderboardProbeStatusResponse\(env\)/);
});

test('cloud keeps redacted capture history in R2 for direct pull reporting', () => {
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/history\//);
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/latest\.json/);
  assert.match(cloudProbe, /SECRET_KEY/);
  assert.match(cloudProbe, /MAX_BODY_CHARS = 65_536/);
  assert.match(cloudProbe, /contentIdentity\(deviceId, records\)/);
  assert.match(cloudProbe, /DATA_BUCKET\.head\(LATEST_KEY\)/);
  assert.match(cloudProbe, /delivery: "r2-pull"/);
  assert.doesNotMatch(cloudProbe, /repository_dispatch|GITHUB_RADAR_DISPATCH_TOKEN/);
  assert.match(reportWorkflow, /LATEST_KEY: diagnostics\/stationhead-leaderboard\/latest\.json/);
  assert.match(reportWorkflow, /Cloudflare R2 REST API/);
  assert.match(reportWorkflow, /name: stationhead-leaderboard-latest/);
  assert.match(reportWorkflow, /actions\/upload-artifact@v4/);
});
