from pathlib import Path

renderer = Path('hp/native/src/renderer_panels.cpp')
text = renderer.read_text(encoding='utf-8')

old_filter = r'''  const isMainEpisodeLink = link =>
      !/(放課後トーク|予告|\bPR\b|ティザー|teaser|trailer|ダイジェスト|番宣|告知)/i
          .test(labelOf(link));
'''
if old_filter not in text:
    raise SystemExit('episode exclusion filter not found')
text = text.replace(old_filter, '', 1)

old_link_filter = ".filter(link => link.href && isMainEpisodeLink(link));"
new_link_filter = ".filter(link => link.href);"
if old_link_filter not in text:
    raise SystemExit('episode link filter call not found')
text = text.replace(old_link_filter, new_link_filter, 1)

old_completion = '''      const completedPreview = state.previewMode &&
          state.maxDuration >= 10 && state.maxTime >= 5;
      const completedEpisode = !state.previewMode &&
          state.maxDuration >= 600 && state.maxTime >= 300;
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= 2500;
      if (stableEnd && (completedPreview || completedEpisode)) {'''
new_completion = '''      const completedItem = state.maxDuration >= 5 &&
          state.maxTime >= Math.max(3, state.maxDuration - 10);
      const stableEndDelayMs = state.maxDuration < 600 ? 8000 : 2500;
      const stableEnd = state.endCandidateAt > 0 &&
          Date.now() - state.endCandidateAt >= stableEndDelayMs;
      if (stableEnd && completedItem) {'''
if old_completion not in text:
    raise SystemExit('completion block not found')
text = text.replace(old_completion, new_completion, 1)
renderer.write_text(text, encoding='utf-8')

legacy_path = Path('hp/video/test/native-media-30-90-tver-alternation-contract.test.js')
legacy = legacy_path.read_text(encoding='utf-8')
legacy = legacy.replace(
    "test('TVer queues public main episodes and keeps completion latching', () => {",
    "test('TVer queues every public series item and keeps completion latching', () => {",
    1,
)
old_legacy = r'''  assert.match(composition, /completedPreview = state\.previewMode/);
  assert.match(composition, /state\.maxDuration >= 10 && state\.maxTime >= 5/);
  assert.match(composition, /Date\.now\(\) - state\.endCandidateAt >= 2500/);
  assert.match(composition, /stableEnd && \(completedPreview \|\| completedEpisode\)/);
'''
new_legacy = r'''  assert.doesNotMatch(composition, /isMainEpisodeLink/);
  assert.match(composition, /\.filter\(link => link\.href\)/);
  assert.match(composition, /completedItem = state\.maxDuration >= 5/);
  assert.match(composition, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(composition, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(composition, /stableEnd && completedItem/);
'''
if old_legacy not in legacy:
    raise SystemExit('legacy completion assertions not found')
legacy = legacy.replace(old_legacy, new_legacy, 1)
legacy_path.write_text(legacy, encoding='utf-8')

all_items_test = Path('hp/video/test/native-tver-all-episodes-contract.test.js')
all_items_test.write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('TVer cycles every published series item before switching series', () => {
  assert.match(composition, /episodeQueueKey = seriesPath/);
  assert.match(composition, /__homePanelTverEpisodeQueue:/);
  assert.doesNotMatch(composition, /isMainEpisodeLink/);
  assert.match(composition, /\.filter\(link => link\.href\)/);
  assert.match(composition, /Array\.from\(new Set\(/);
  assert.match(composition, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(composition, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(composition, /nextIndex < queue\.hrefs\.length/);
  assert.match(composition, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(composition, /clearEpisodeQueue\(seriesPath\)/);
});

test('TVer short items wait out ad transitions before advancing', () => {
  assert.match(composition, /completedItem = state\.maxDuration >= 5/);
  assert.match(composition, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(composition, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(composition, /Date\.now\(\) - state\.endCandidateAt >= stableEndDelayMs/);
  assert.match(
    composition,
    /stableEnd && completedItem[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*state\.restartRequested = true/,
  );
});
''', encoding='utf-8')
