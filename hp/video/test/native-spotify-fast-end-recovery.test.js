import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const observer = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url),
  'utf8',
);
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);

test('one delegated observer covers current and dynamically created media', () => {
  assert.match(wrapper, /#include "spotify_fast_end_observer\.inc"/);
  assert.match(observer, /__homePanelSpotifyMediaObserverInstalled/);
  assert.match(observer, /document\.addEventListener\('play'/);
  assert.match(observer, /document\.addEventListener\('playing'/);
  assert.match(observer, /document\.addEventListener\('ended'/);
  assert.doesNotMatch(observer, /media\.addEventListener/);
  assert.doesNotMatch(observer, /MutationObserver|setInterval/);
});

test('confirmed target media starts the deadline and ends immediately', () => {
  assert.match(observer, /state\.targetMedia = media/);
  assert.match(observer, /post\('spotify:timed-started'\)/);
  assert.match(observer, /state\.targetMedia !== media/);
  assert.match(observer, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(observer, /spotify:timed-waiting|waitForNext/);
});

test('target changes and ended gaps cannot play an item from the old queue', () => {
  assert.match(
    scripts,
    /if \(changed\) \{[\s\S]*document\.querySelectorAll\('audio, video'\)[\s\S]*media\.pause\(\)/,
  );
  assert.match(
    observer,
    /target\.kind === 'music' && state\.endedPosted[\s\S]*event\.target\.pause\(\)/,
  );
  assert.match(
    observer,
    /state\.endedPosted = true;[\s\S]*candidate\.pause\(\)[\s\S]*post\('spotify:timed-ended'\)/,
  );
  assert.match(
    timed,
    /PostSpotifyTargetDescriptorForSlot\(slot\);[\s\S]*kSpotifyStaticStopPlaybackScript[\s\S]*Navigate\(url\)/,
  );
  assert.match(
    recent,
    /PostSpotifyTargetDescriptorForSlot\(slot\);[\s\S]*kSpotifyStaticStopPlaybackScript[\s\S]*Navigate\(url\)/,
  );
  assert.match(
    recent,
    /case TimedSpotifyTarget::LonesomeRabbit:[\s\S]*trackPath = kSpotifyLonesomeRabbitPath/,
  );
});

test('pause, waiting, and stalled recover only after playback stays stopped', () => {
  assert.match(observer, /document\.addEventListener\('pause'/);
  assert.match(observer, /\['waiting', 'stalled'\]/);
  assert.match(observer, /scheduleRecovery\(event\.target, 600, true\)/);
  assert.match(observer, /scheduleRecovery\(event\.target, 2500, false\)/);
  assert.match(observer, /media\.currentTime[\s\S]*startTime \+ 0\.05/);
  assert.match(observer, /post\('spotify:not-playing'\)/);
  assert.match(rotation, /const bool stopped =[\s\S]*spotify:not-playing/);
  assert.match(rotation, /staggerSlotIndex_ = target->index/);
});

test('observer injection is retried only until one install succeeds', () => {
  assert.match(header, /bool timedObserverReady = false/);
  assert.match(header, /bool timedObserverInstallInFlight = false/);
  assert.match(
    rotation,
    /if \(slot\.timedObserverReady \|\| slot\.timedObserverInstallInFlight\) return;/,
  );
  assert.match(rotation, /observerTarget->timedObserverReady =[\s\S]*SUCCEEDED\(result\)/);
  assert.doesNotMatch(
    rotation,
    /PostSpotifyTargetDescriptorForSlot\(slot\);[\s\S]*kSpotifyStaticTimedStartObserverScript/,
  );
});

test('four-minute actual-play deadline remains a native fallback', () => {
  assert.match(rotation, /kSpotifyTimedTrackDeadlineMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(rotation, /AdvanceExpiredTimedRotation/);
});
