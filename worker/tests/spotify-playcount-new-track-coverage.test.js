import assert from 'node:assert/strict';
import test from 'node:test';

import { rawTargetTrackCoverage } from '../src/spotify-playcount-consumer.js';

const targets = [{ artist_key: 'sakurazaka46', spotify_artist_id: 'target-artist' }];

test('target track without a playcount is reported even when sibling tracks are valid', () => {
  const payload = {
    data: {
      album: {
        artists: { items: [{ uri: 'spotify:artist:target-artist' }] },
        tracks: {
          items: [
            {
              track: {
                id: 'existing-track',
                playcount: '123',
                artists: { items: [{ uri: 'spotify:artist:target-artist' }] },
              },
            },
            {
              track: {
                id: 'new-track',
                name: '自称バレエダンサー',
                artists: { items: [{ uri: 'spotify:artist:target-artist' }] },
              },
            },
          ],
        },
      },
    },
  };

  assert.deepEqual(rawTargetTrackCoverage(payload, targets), {
    complete: true,
    hasTargetCredit: true,
    targetTracks: 2,
    invalidTargetTracks: 1,
  });
});

test('album artist fallback still detects a target track without a playcount', () => {
  const payload = {
    data: {
      album: {
        artists: { items: [{ uri: 'spotify:artist:target-artist' }] },
        tracks: { items: [{ track: { id: 'new-track', name: '自称バレエダンサー' } }] },
      },
    },
  };

  const coverage = rawTargetTrackCoverage(payload, targets);
  assert.equal(coverage.targetTracks, 1);
  assert.equal(coverage.invalidTargetTracks, 1);
});

test('unrelated tracks do not count as missing target playcounts', () => {
  const payload = {
    data: {
      album: {
        tracks: {
          items: [{
            track: {
              id: 'other-track',
              artists: { items: [{ uri: 'spotify:artist:other-artist' }] },
            },
          }],
        },
      },
    },
  };

  assert.deepEqual(rawTargetTrackCoverage(payload, targets), {
    complete: true,
    hasTargetCredit: false,
    targetTracks: 0,
    invalidTargetTracks: 0,
  });
});