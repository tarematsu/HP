import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourcePaths = [
  '../../native/src/common.h',
  '../../native/src/render_state.h',
  '../../native/src/update_shutdown_protocol.h',
  '../../native/src/app_startup_tick_fallback.h',
  '../../native/src/app.h',
  '../../native/src/app_messages.cpp',
  '../../native/src/cloud_client.cpp',
];

function readSource(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('native WM_APP message IDs do not alias unrelated handlers', () => {
  const byOffset = new Map();
  const pattern = /(?:inline\s+)?(?:static\s+)?constexpr\s+UINT\s+(\w+)\s*=\s*WM_APP\s*\+\s*(\d+)/g;

  for (const path of sourcePaths) {
    const source = readSource(path);
    for (const match of source.matchAll(pattern)) {
      const [, name, rawOffset] = match;
      const offset = Number(rawOffset);
      const entries = byOffset.get(offset) ?? [];
      entries.push({ name, path });
      byOffset.set(offset, entries);
    }
  }

  const collisions = [];
  for (const [offset, entries] of byOffset) {
    const distinctNames = new Set(entries.map(entry => entry.name));
    if (distinctNames.size > 1) {
      collisions.push({ offset, entries });
    }
  }

  assert.deepEqual(
    collisions,
    [],
    `unrelated WM_APP messages share an offset: ${JSON.stringify(collisions)}`,
  );
});

test('dashboard actions cannot be interpreted as updater shutdown', () => {
  const renderer = readSource('../../native/src/render_state.h');
  const updater = readSource('../../native/src/update_shutdown_protocol.h');

  const rendererOffset = Number(
    renderer.match(/kRendererActionMessage\s*=\s*WM_APP\s*\+\s*(\d+)/)?.[1],
  );
  const updaterOffset = Number(
    updater.match(/kUpdateShutdownMessage\s*=\s*WM_APP\s*\+\s*(\d+)/)?.[1],
  );

  assert.ok(Number.isInteger(rendererOffset));
  assert.ok(Number.isInteger(updaterOffset));
  assert.notEqual(rendererOffset, updaterOffset);
});
