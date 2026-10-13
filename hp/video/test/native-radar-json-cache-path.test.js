import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const radarCache = readFileSync(
  new URL('../../native/src/cloud_client_radar_cache.cpp', import.meta.url),
  'utf8',
);

test('radar JSON fast path points at the same localized representative PNG cache', () => {
  assert.match(radarCache, /const fs::path cacheRoot = dataDir_ \/ L"radar-cache"/);
  assert.match(
    renderer,
    /dataDir \/ L"radar-cache" \/ L"v1" \/ L"radar" \/ L"frame" \/\s*L"representative" \/ L"latest\.png"/s,
  );
  assert.match(renderer, /const std::string stamp = file::Stamp\(\*framePath\)/);
});


const header = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const windows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'missing radar section ' + start);
  return source.slice(from, to);
}

test('radar update bursts enqueue one wake for the single compositor thread', () => {
  const notify = section(renderer,
    'void Renderer::NotifyRadarUpdated()', 'void Renderer::StartRadarCompose()');
  assert.match(notify, /if \(!radarComposeStarted_\.load\(std::memory_order_acquire\)\) return/);
  assert.match(notify, /std::lock_guard lock\(radarComposeWakeMutex_\)/);
  assert.match(notify, /if \(!radarComposePending_\) \{\s*radarComposePending_ = true;\s*notify = true;/);
  assert.match(notify, /if \(notify\) radarComposeWake_\.notify_one\(\)/);
  assert.doesNotMatch(notify, /notify_all\(\)/);
  const loop = section(renderer,
    'void Renderer::RadarComposeLoop()', 'void Renderer::ComposeRadarFrame()');
  assert.match(loop, /radarComposeWake_\.wait\(waitLock, \[this\]/);
  assert.match(loop, /radarComposePending_ = false;/);
  assert.match(loop, /ComposeRadarFrame\(\)/);
  // The producer coalesces only requests that are still queued, while a wake
  // arriving during the long PNG decoding pass becomes a fresh pending job.
  let pending = false, notifications = 0;
  const notifyModel = () => {
    if (!pending) { pending = true; notifications++; }
  };
  for (let i = 0; i < 100; i++) notifyModel();
  assert.equal(notifications, 1);
  pending = false; // worker consumed request before decoding
  notifyModel();
  assert.equal(notifications, 2);
  assert.equal(pending, true);
});

test('unchanged radar PNG bypasses signature construction and decoding', () => {
  assert.match(header, /fs::path radarFrameSourcePath_;/);
  assert.match(header, /std::string radarPngStamp_;/);
  const compose = section(renderer,
    'void Renderer::ComposeRadarFrame()', '}  // namespace hp');
  const start = compose.indexOf('const std::string stamp = file::Stamp(*framePath)');
  const fast = compose.indexOf('radarFrameSourcePath_ == *framePath');
  const stamp = compose.indexOf('radarPngStamp_ == stamp');
  const signature = compose.indexOf('RepresentativeRadarSignature(*framePath, stamp)');
  const decode = compose.indexOf('DecodeImageFileToBitmap(');
  assert.ok(start >= 0 && fast > start && stamp > fast && signature > stamp && decode > signature);
  assert.match(compose, /if \(radarFrameBitmap_ && radarFrameSourcePath_ == \*framePath &&\s*radarPngStamp_ == stamp\) \{\s*radarJsonStamp_ = jsonStamp;\s*return;/);
  assert.match(compose, /if \(radarFrameBitmap_ && radarSignature_ == signature\)/);
  assert.match(compose, /radarFrameBitmap_ = decoded;\s*radarSignature_ = signature;\s*radarJsonStamp_ = jsonStamp;\s*radarFrameSourcePath_ = \*framePath;\s*radarPngStamp_ = stamp;/);
  // A same-sized replacement with changed timestamp, or a new path, MUST decode.
  const unchanged = (present, oldPath, oldStamp, path, nextStamp) =>
    present && oldPath === path && oldStamp === nextStamp;
  assert.equal(unchanged(true, 'a.png', '1:2', 'a.png', '1:2'), true);
  assert.equal(unchanged(true, 'a.png', '1:2', 'a.png', '1:3'), false);
  assert.equal(unchanged(true, 'a.png', '1:2', 'b.png', '1:2'), false);
  assert.equal(unchanged(false, 'a.png', '1:2', 'a.png', '1:2'), false);
});

test('radar fast-path identity is cleared when its bitmap is retired', () => {
  assert.match(lifecycle, /radarFrameBitmap_ = nullptr;\s*radarSignature_\.clear\(\);\s*radarFrameSourcePath_\.clear\(\);\s*radarPngStamp_\.clear\(\)/);
  assert.match(windows, /radarFrameBitmap_ = nullptr;\s*radarFrameSourcePath_\.clear\(\);\s*radarPngStamp_\.clear\(\)/);
  assert.match(renderer, /radarComposeWake_\.notify_all\(\)/);
});
