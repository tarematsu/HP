import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');

test('Stationhead repeated healthy media clocks avoid redundant status string construction', () => {
  const begin = player.indexOf('void UpdateHealthyAudioDetail(');
  const end = player.indexOf('bool CallbackAlive(', begin);
  const applied = player.indexOf('void StationheadPlayer::ApplyAudioPlaybackState(');
  assert.ok(begin > 0 && end > begin && applied > end);
  const helper = player.slice(begin, end);
  const playback = player.slice(applied,
    player.indexOf('void StationheadPlayer::NavigateCurrentUrl(', applied));
  assert.match(helper, /const std::wstring_view current\(detail\)/);
  assert.match(helper, /current\.size\(\) == expectedSize && current\.starts_with\(base\)/);
  assert.match(helper, /return;\s*\}\s*detail\.assign\(base\.data\(\), base\.size\(\)\)/);
  assert.match(playback,
    /UpdateHealthyAudioDetail\(\s*status_\.detail, preserveLoginRequired, usingFallback_, source\)/);
  assert.match(playback, /std::lock_guard lock\(mutex_\)/);
  assert.match(playback, /if \(changed \|\| awaitingTrackBoundaryNavigation \|\|/);
  assert.match(playback, /lastHealthySurfaceRepairTick_/);
});

test('compiled production Stationhead formatter preserves statuses for source/login/fallback changes', () => {
  const begin = player.indexOf('void UpdateHealthyAudioDetail(');
  const end = player.indexOf('bool CallbackAlive(', begin);
  assert.ok(begin >= 0 && end > begin);
  const dir = mkdtempSync(join(tmpdir(), 'stationhead-healthy-detail-'));
  try {
    const filename = join(dir, 'detail.cpp');
    const exe = join(dir, process.platform === 'win32' ? 'detail.exe' : 'detail');
    writeFileSync(filename, "#include <cassert>\n#include <string>\n#include <string_view>\n" + player.slice(begin, end) + "\nint main() {\n  std::wstring detail;\n  UpdateHealthyAudioDetail(detail, false, false, L\"WebView2 + media clock\");\n  assert(detail == L\"audio detected (WebView2 + media clock)\");\n  const wchar_t* stable = detail.data();\n  UpdateHealthyAudioDetail(detail, false, false, L\"WebView2 + media clock\");\n  assert(detail == L\"audio detected (WebView2 + media clock)\");\n  assert(detail.data() == stable);\n  UpdateHealthyAudioDetail(detail, false, true, L\"WebView2 + media clock\");\n  assert(detail == L\"fallback audio detected (WebView2 + media clock)\");\n  UpdateHealthyAudioDetail(detail, true, false, L\"media clock\");\n  assert(detail == L\"Stationhead login required; audio continues\");\n  UpdateHealthyAudioDetail(detail, false, false, L\"\");\n  assert(detail == L\"audio detected\");\n  UpdateHealthyAudioDetail(detail, false, true, L\"\");\n  assert(detail == L\"fallback audio detected\");\n  detail = L\"Spotify authorization pending\";\n  UpdateHealthyAudioDetail(detail, false, false, L\"media clock\");\n  assert(detail == L\"audio detected (media clock)\");\n  UpdateHealthyAudioDetail(detail, false, false, L\"source A\");\n  assert(detail == L\"audio detected (source A)\");\n  UpdateHealthyAudioDetail(detail, false, false, L\"source B\");\n  assert(detail == L\"audio detected (source B)\");\n  UpdateHealthyAudioDetail(detail, false, false, L\"日本語\");\n  assert(detail == L\"audio detected (日本語)\");\n}\n");
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
      filename, '-o', exe]);
    execFileSync(exe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
