import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPlayed, revealPlayedPeriod } from '../public/stationhead/played-tracks.js';

test('selected playback date stays visible without moving the page', () => {
  const button = { offsetLeft: 1600, offsetWidth: 80 };
  const strip = { offsetLeft: 100, scrollLeft: 0, clientWidth: 400, querySelector: () => button };
  button.getBoundingClientRect = () => ({ left: button.offsetLeft - strip.scrollLeft, right: button.offsetLeft - strip.scrollLeft + button.offsetWidth });
  strip.getBoundingClientRect = () => ({ left: strip.offsetLeft });
  revealPlayedPeriod(strip);
  assert.equal(strip.scrollLeft, 1180);
  button.offsetLeft = 200;
  revealPlayedPeriod(strip);
  assert.equal(strip.scrollLeft, 100);
});

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

