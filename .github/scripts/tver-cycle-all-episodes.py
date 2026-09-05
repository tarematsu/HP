from pathlib import Path

path = Path('hp/native/src/renderer_panels.cpp')
text = path.read_text(encoding='utf-8')
marker = 'constexpr wchar_t kNativeMediaTverLoopOverrideScript[] = LR"JS('
script_start = text.index(marker)
open_start = text.index('  const openPreferredEpisode = () => {', script_start)
ensure_start = text.index('\n  const ensureEpisodePlayback = () => {', open_start)

replacement = r'''  const episodeQueueKey = seriesPath =>
      '__homePanelTverEpisodeQueue:' + seriesPath;
  const isMainEpisodeLink = link =>
      !/(放課後トーク|予告|\bPR\b|ティザー|teaser|trailer|ダイジェスト|番宣|告知)/i
          .test(labelOf(link));
  const normalizeEpisodeHref = href => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin ||
          !url.pathname.startsWith('/episodes/')) return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  };
  const readEpisodeQueue = seriesPath => {
    try {
      const value = JSON.parse(
          sessionStorage.getItem(episodeQueueKey(seriesPath)) || 'null');
      if (!value || !Array.isArray(value.hrefs)) {
        return { hrefs: [], index: -1 };
      }
      return {
        hrefs: value.hrefs.filter(href => typeof href === 'string'),
        index: Number.isInteger(value.index) ? value.index : -1,
      };
    } catch (_) {
      return { hrefs: [], index: -1 };
    }
  };
  const writeEpisodeQueue = (seriesPath, hrefs, index) => {
    try {
      sessionStorage.setItem(
          episodeQueueKey(seriesPath), JSON.stringify({ hrefs, index }));
    } catch (_) {
    }
  };
  const clearEpisodeQueue = seriesPath => {
    try { sessionStorage.removeItem(episodeQueueKey(seriesPath)); } catch (_) {}
  };

  const openPreferredEpisode = () => {
    const seriesPath = location.pathname;
    rememberSeriesPath(seriesPath);
    const links = Array.from(document.querySelectorAll('a[href*="/episodes/"]'))
        .filter(link => link.href && isMainEpisodeLink(link));
    const hrefs = Array.from(new Set(
        links.map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));
    if (!hrefs.length) return;
    writeEpisodeQueue(seriesPath, hrefs, 0);
    location.replace(hrefs[0]);
  };

  const advanceEpisodeOrSeries = () => {
    const seriesPath = storedSeriesPath();
    const queue = readEpisodeQueue(seriesPath);
    if (!queue.hrefs.length) return false;
    const currentIndex = queue.hrefs.findIndex(href => {
      try {
        return new URL(href, location.href).pathname === location.pathname;
      } catch (_) {
        return false;
      }
    });
    const baseIndex = currentIndex >= 0 ? currentIndex : queue.index;
    const nextIndex = baseIndex + 1;
    if (nextIndex >= 0 && nextIndex < queue.hrefs.length) {
      writeEpisodeQueue(seriesPath, queue.hrefs, nextIndex);
      window.__homePanelSakuraMeetsState = null;
      location.replace(queue.hrefs[nextIndex]);
      return true;
    }
    clearEpisodeQueue(seriesPath);
    return false;
  };
'''

text = text[:open_start] + replacement + text[ensure_start:]

old_end = '''      if (stableEnd && (completedPreview || completedEpisode)) {
        state.restartRequested = true;
        return;
      }'''
new_end = '''      if (stableEnd && (completedPreview || completedEpisode)) {
        if (advanceEpisodeOrSeries()) return;
        state.restartRequested = true;
        return;
      }'''
if old_end not in text:
    raise SystemExit('stable-end block not found')
text = text.replace(old_end, new_end, 1)
path.write_text(text, encoding='utf-8')

test_path = Path('hp/video/test/native-tver-all-episodes-contract.test.js')
test_path.write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('TVer cycles every published main episode before switching series', () => {
  assert.match(composition, /episodeQueueKey = seriesPath/);
  assert.match(composition, /__homePanelTverEpisodeQueue:/);
  assert.match(
    composition,
    /放課後トーク\|予告\|\\bPR\\b\|ティザー\|teaser\|trailer\|ダイジェスト\|番宣\|告知/i,
  );
  assert.match(composition, /Array\.from\(new Set\(/);
  assert.match(composition, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(composition, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(composition, /nextIndex < queue\.hrefs\.length/);
  assert.match(composition, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(composition, /clearEpisodeQueue\(seriesPath\)/);
  assert.match(
    composition,
    /stableEnd && \(completedPreview \|\| completedEpisode\)[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*state\.restartRequested = true/,
  );
});
''', encoding='utf-8')
