import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const file = path => readFileSync(new URL('../../native/src/' + path, import.meta.url), 'utf8');
const player = file('sh.cpp');
const handle = file('app_stationhead_handles.cpp');
const app = file('app_messages.cpp');
const flags = file('stationhead_types.h');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, 'missing ' + start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, 'missing ' + end);
  return source.slice(from, to);
}

test('zero-action PostChange still signals the originating Stationhead profile', () => {
  assert.match(flags, /StationheadChangeStatusUpdated = 1u << 3/);
  const consume = between(player,
    'uint32_t StationheadPlayer::ConsumeChangeFlags() {',
    'void StationheadPlayer::PostChange(');
  assert.match(consume, /pendingChangeFlags_\.exchange\(0, std::memory_order_acq_rel\)/);
  assert.match(consume, /changeMessagePending_\.exchange\(false, std::memory_order_acq_rel\)/);
  assert.match(consume, /return flags \| \(messagePending \? StationheadChangeStatusUpdated : 0\)/);
  assert.match(consume, /pendingChangeFlags_\.load\(std::memory_order_acquire\)/,
    'new action flags must still be reposted if received during consumption');
});

test('six-window status wake skips unrelated window preview and revision changes', () => {
  const consume = between(handle,
    'uint32_t StationheadHandleBase::ConsumeChangeFlags() {',
    'void StationheadHandleBase::AssignPlayer(');
  const guard = consume.indexOf('if (flags == StationheadChangeNone) return flags;');
  const preview = consume.indexOf('SyncStationheadBackgroundPreview(*player_, workspaceBounds_)');
  const revision = consume.indexOf('++contentRevision_');
  assert.ok(guard >= 0 && preview > guard && revision > preview);
  assert.match(consume, /StationheadChangeReleaseAuth/);
  const handler = between(app, 'case WM_HP_STATIONHEAD_CHANGED:', 'case WM_HP_CONFIG_UPDATED:');
  assert.match(handler, /if \(changes == StationheadChangeNone\) continue;/);
  assert.match(handler, /if \(changes != StationheadChangeNone\) \{/);
  assert.match(handler, /if \(!handled\) return 0;/);
  const last = handler.indexOf('MarkStationheadPlacementDirty();');
  assert.ok(last > handler.indexOf('if (!handled) return 0;'),
    'no-op wakes must not reposition six WebView2 controllers');
});

test('only targeted profile is updated for regular and zero-action notifications', () => {
  const none = 0, showPlayer = 1 << 2, statusChanged = 1 << 3;
  const changes = Array.from({length: 6}, () => ({pending: false, flags: 0, revision: 1}));
  const flush = () => {
    let handled = false;
    for (const state of changes) {
      const bits = state.flags | (state.pending ? statusChanged : 0);
      state.pending = false;
      state.flags = none;
      if (bits === none) continue;
      state.revision++;
      handled = true;
    }
    return handled;
  };
  changes[4].pending = true;
  assert.equal(flush(), true);
  assert.deepEqual(changes.map(x => x.revision), [1,1,1,1,2,1]);
  assert.equal(flush(), false);
  changes[2].pending = true;
  changes[2].flags = showPlayer;
  assert.equal(flush(), true);
  assert.deepEqual(changes.map(x => x.revision), [1,1,2,1,2,1]);
});
