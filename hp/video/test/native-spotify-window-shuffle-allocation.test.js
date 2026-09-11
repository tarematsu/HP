import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cycle = readFileSync(
  new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url),
  'utf8',
);

const laneStarts = ({ candidateCount, count = 1, groupIndex = 0, random = true }) => {
  const accountCount = 6;
  const laneWidth = random ? Math.max(1, Math.min(count, candidateCount)) : 1;
  return Array.from({ length: accountCount }, (_, slotIndex) =>
    (groupIndex * accountCount + slotIndex * laneWidth) % candidateCount);
};

test('shuffle base permutation is shared while window index only rotates the lane', () => {
  assert.match(cycle, /Every account derives the same base permutation/);
  assert.match(cycle, /slot\.index is\s*\/\/ intentionally excluded from this seed/);
  assert.match(cycle, /scheduleStartTick_/);
  assert.match(cycle, /cloudRotationRevision_/);
  assert.match(cycle, /slot\.timedRotationCycle/);
  assert.match(cycle, /currentGroupIndex/);
  assert.match(cycle, /const size_t laneStart =/);
  assert.match(cycle, /slot\.index \* laneWidth/);
  assert.match(cycle, /std::rotate\(/);
});

test('six windows receive six distinct current songs when a shuffle pool has at least six tracks', () => {
  const starts = laneStarts({ candidateCount: 20, groupIndex: 4, random: false });
  assert.equal(new Set(starts).size, 6);
});

test('random count-sized lanes are disjoint when the candidate pool is large enough', () => {
  const candidateCount = 12;
  const count = 2;
  const starts = laneStarts({ candidateCount, count, groupIndex: 5, random: true });
  const selected = starts.flatMap(start =>
    Array.from({ length: count }, (_, offset) => (start + offset) % candidateCount));
  assert.equal(new Set(selected).size, 12);
});

test('small pools wrap with only the mathematically unavoidable duplication', () => {
  const starts = laneStarts({ candidateCount: 5, groupIndex: 1, random: false });
  assert.equal(new Set(starts).size, 5);
});

test('fixed groups bypass per-window lane rotation and existing cycle dedupe remains', () => {
  assert.match(cycle, /if \(group\.mode != RotationGroup::Mode::Fixed\)/);
  assert.match(cycle, /std::vector<std::wstring> usedPaths/);
  assert.match(cycle, /appendUnique/);
});
