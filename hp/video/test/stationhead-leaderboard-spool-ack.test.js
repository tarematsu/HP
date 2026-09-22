import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('native spool receipts never delete records from a replaced upload batch', () => {
  const source = readFileSync(new URL('../../native/src/stationhead_leaderboard_capture_spool.h', import.meta.url), 'utf8');
  const start = source.indexOf('inline bool Acknowledge(');
  const end = source.indexOf('\n}  // namespace', start);
  assert.ok(start >= 0 && end > start);
  // Execute the production C++ acknowledgement with an in-memory disk boundary.
  // This deterministically interleaves append/eviction between read and receipt.
  const directory = mkdtempSync(join(tmpdir(), 'hp-spool-ack-'));
  try {
    const input = join(directory, 'test.cpp');
    const binary = join(directory, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(input, `
#include <algorithm>
#include <cassert>
#include <cstddef>
#include <mutex>
#include <string>
#include <vector>
using Lines = std::vector<std::string>;
Lines disk;
bool writeSucceeds = true;
int writes = 0;
std::mutex& SpoolMutex() { static std::mutex mutex; return mutex; }
Lines ReadLinesLocked() { return disk; }
bool WriteLinesLocked(const Lines& lines) {
  ++writes;
  if (!writeSucceeds) return false;
  disk = lines;
  return true;
}
${source.slice(start, end)}
int main() {
  disk = {"a", "b", "c"};
  const Lines batch = {"a", "b"};
  disk.push_back("new");
  assert(Acknowledge(batch, 2));
  assert((disk == Lines{"c", "new"}));

  // The bounded queue has dropped a while this batch was uploading.
  disk = {"b", "c", "new"};
  const auto before = disk;
  const auto writesBefore = writes;
  assert(!Acknowledge(batch, 2));
  assert(disk == before && writes == writesBefore);
  // A fresh exchange can drain the preserved queue normally.
  assert(Acknowledge(before, before.size()));
  assert(disk.empty());

  // Duplicate/delayed receipts and invalid counts cannot consume a new batch.
  disk = {"new"};
  assert(!Acknowledge(batch, 2));
  assert(!Acknowledge(batch, 3));
  assert(Acknowledge(batch, 0));
  assert((disk == Lines{"new"}));

  disk = {"a", "b", "c"};
  assert(Acknowledge(batch, 1));
  assert((disk == Lines{"b", "c"}));
  assert(!Acknowledge(batch, 1));
  assert((disk == Lines{"b", "c"}));

  disk = batch;
  writeSucceeds = false;
  assert(!Acknowledge(batch, 2));
  assert(disk == batch);
}
`);
    execFileSync('g++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', input, '-o', binary], { stdio: 'pipe' });
    execFileSync(binary, [], { stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
