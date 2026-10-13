import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/cloud_client_exchange.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/cloud_client.h', import.meta.url), 'utf8');

test('shared telemetry snapshot does not duplicate the pending JSON on every cloud poll', () => {
  assert.match(header, /std::shared_ptr<PendingTelemetry> pendingTelemetry_/);
  assert.doesNotMatch(header, /std::optional<PendingTelemetry> pendingTelemetry_/);
  assert.match(source, /pendingTelemetry_ = std::make_shared<PendingTelemetry>/);
  assert.match(source, /std::shared_ptr<PendingTelemetry> telemetry/);
  assert.match(source, /telemetry = pendingTelemetry_/);
  assert.match(source, /pendingTelemetry_->generation == telemetry->generation/);
  assert.match(source, /callback = std::move\(pendingTelemetry_->callback\)/);
  assert.match(source, /pendingTelemetry_\.reset\(\)/);
});

test('compiled cloud queue retains latest-generation receipts and callback exactly once', () => {
  const start = source.indexOf('void CloudClient::QueueTelemetry(');
  const end = source.indexOf('std::optional<HttpResponse> CloudClient::TryCompressedExchange(', start);
  assert.ok(start >= 0 && end > start);
  const queueMethod = source.slice(start, end);
  const dir = mkdtempSync(join(tmpdir(), 'native-telemetry-snapshot-'));
  try {
    const input = join(dir, 'test.cpp');
    const output = join(dir, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(input, "#include <cassert>\n#include <cstdint>\n#include <functional>\n#include <memory>\n#include <mutex>\n#include <string>\n#include <utility>\nstruct TelemetryReceipt { bool success = true; };\nclass CloudClient {\n public:\n  using TelemetryCallback = std::function<void(TelemetryReceipt)>;\n  struct PendingTelemetry {\n    uint64_t generation = 0;\n    std::string json;\n    TelemetryCallback callback;\n  };\n  std::mutex pendingTelemetryMutex_;\n  std::shared_ptr<PendingTelemetry> pendingTelemetry_;\n  uint64_t pendingTelemetryGeneration_ = 0;\n  void QueueTelemetry(std::string json, TelemetryCallback callback);\n  std::shared_ptr<PendingTelemetry> Capture() {\n    std::lock_guard lock(pendingTelemetryMutex_);\n    return pendingTelemetry_;\n  }\n  void Acknowledge(const std::shared_ptr<PendingTelemetry>& telemetry) {\n    TelemetryCallback callback;\n    {\n      std::lock_guard lock(pendingTelemetryMutex_);\n      if (pendingTelemetry_ &&\n          pendingTelemetry_->generation == telemetry->generation) {\n        callback = std::move(pendingTelemetry_->callback);\n        pendingTelemetry_.reset();\n      }\n    }\n    if (callback) callback(TelemetryReceipt{});\n  }\n};\n" + queueMethod + "\nint main() {\n  CloudClient cloud;\n  int oldAcknowledgements = 0;\n  int newAcknowledgements = 0;\n  cloud.QueueTelemetry(\"{\\\"samples\\\":[1]}\", [&](TelemetryReceipt) { ++oldAcknowledgements; });\n  auto original = cloud.Capture();\n  auto same = cloud.Capture();\n  assert(original && original == same);\n  assert(original->json == \"{\\\"samples\\\":[1]}\");\n  cloud.QueueTelemetry(\"{\\\"samples\\\":[2]}\", [&](TelemetryReceipt) { ++newAcknowledgements; });\n  assert(cloud.Capture()->generation != original->generation);\n  cloud.Acknowledge(original);\n  assert(oldAcknowledgements == 0 && newAcknowledgements == 0);\n  assert(cloud.Capture()->json == \"{\\\"samples\\\":[2]}\");\n  auto current = cloud.Capture();\n  cloud.Acknowledge(current);\n  assert(oldAcknowledgements == 0 && newAcknowledgements == 1);\n  assert(!cloud.Capture());\n  cloud.Acknowledge(current);\n  assert(newAcknowledgements == 1);\n  cloud.QueueTelemetry(\"\", [&](TelemetryReceipt) { ++oldAcknowledgements; });\n  assert(!cloud.Capture());\n}\n");
    execFileSync('g++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', input, '-o', output]);
    execFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
