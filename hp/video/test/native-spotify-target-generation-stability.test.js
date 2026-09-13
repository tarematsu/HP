import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lifecycle = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url),
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

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} not found`);
  assert.ok(end > start, `${endMarker} not found after ${startMarker}`);
  return source.slice(start, end);
}

test('navigation invalidates page and async callbacks without changing the playback target generation', () => {
  const navigation = between(
    lifecycle,
    'slot.webview->add_NavigationStarting(',
    'slot.webview->add_NavigationCompleted(',
  );

  assert.doesNotMatch(navigation, /BumpSpotifyTargetGeneration/);
  assert.doesNotMatch(navigation, /timedCompletionDeadlineTick\s*=\s*0/);
  assert.doesNotMatch(navigation, /timedCompletionDeadlineGeneration\s*=\s*0/);
  assert.match(navigation, /\+\+target->pageEpoch/);
  assert.match(navigation, /\+\+target->asyncEpoch/);
  assert.match(navigation, /target->asyncWork = AsyncWork::None/);
  assert.match(navigation, /target->trustedClickBlockedUntilTick\s*=\s*0/);
  assert.match(navigation, /target->timedObserverReady\s*=\s*false/);
  assert.doesNotMatch(navigation, /reconcileRequestGeneration|timedObserverInstallGeneration|trustedClickGeneration/);
});

test('Spotify target generation changes only when the rotation target changes', () => {
  const applyTarget = between(
    rotation,
    'void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept',
    'void SpotifyWebViews::InitializeTimedRotationSlot(',
  );
  const dueCompletions = between(
    rotation,
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept',
    'void SpotifyWebViews::ArmTimedEndObserver(',
  );

  assert.match(applyTarget, /BumpSpotifyTargetGeneration\(slot\)/);
  assert.match(applyTarget, /\+\+slot\.asyncEpoch/);
  assert.match(
    dueCompletions,
    /timedCompletionDeadlineGeneration\s*!=\s*slot\.targetGeneration/,
  );
  assert.match(dueCompletions, /AdvanceTimedRotationSlot\(slot\)/);
  assert.match(header, /ULONGLONG targetGeneration = 0/);
});
