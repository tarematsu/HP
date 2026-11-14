import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRegionalRecollectionSelection } from '../scripts/resolve-regional-recollection-services.mjs';

test('pushes that change KKBOX scheduling recollect only KKBOX', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'push',
    changedFiles: ['worker/src/cron-dispatcher-entry.js', 'worker/src/scheduled-crons.js'],
  }), { services: 'kkbox', verifyYoutube: false });
});

test('pushes that change YouTube Music source code recollect YouTube Music', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'push',
    changedFiles: ['worker/src/regional-music-youtube-music.js'],
  }), { services: 'youtube_music', verifyYoutube: true });
});

test('pushes that change both collectors recollect both services', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'push',
    changedFiles: ['worker/src/regional-music-service-entry.js', 'worker/src/regional-music-dispatch-plan.js'],
  }), { services: 'kkbox,youtube_music', verifyYoutube: true });
});

test('pushes that change only the recollection workflow still run the KKBOX repair path', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'push',
    changedFiles: ['.github/workflows/recollect-regional-music-manual.yml'],
  }), { services: 'kkbox', verifyYoutube: false });
});

test('empty manual selection means all services and verifies YouTube Music', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'workflow_dispatch',
    manualServices: '',
  }), { services: '', verifyYoutube: true });
});

test('manual KKBOX-only selection skips the YouTube verification', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'workflow_dispatch',
    manualServices: 'kkbox',
  }), { services: 'kkbox', verifyYoutube: false });
});

test('manual YouTube Music selection verifies the refreshed source', () => {
  assert.deepEqual(resolveRegionalRecollectionSelection({
    eventName: 'workflow_dispatch',
    manualServices: ' kkbox, youtube_music,kkbox ',
  }), { services: 'kkbox,youtube_music', verifyYoutube: true });
});
