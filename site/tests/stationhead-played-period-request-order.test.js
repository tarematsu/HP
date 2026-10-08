import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPlayed } from '../public/stationhead/played-tracks.js';

test('obsolete Stationhead played-period requests must not overwrite the current period cache', async () => {
  let finishIndex;
  const pendingIndex = new Promise((resolve) => { finishIndex = resolve; });
  const runtime = {
    section: 'played-tracks',
    playedSequence: 0,
    playedDates: ['2026-10-01'],
    root: { hidden: false },
    model: { loadPlayedIndex: () => pendingIndex },
  };

  const loading = loadPlayed(runtime, { force: true });
  runtime.section = 'current';
  finishIndex(['2026-10-08']);
  await loading;

  assert.deepEqual(runtime.playedDates, ['2026-10-01']);
});
