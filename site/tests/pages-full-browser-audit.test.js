import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audit = readFileSync(new URL('../../scripts/audit-pages-live.mjs', import.meta.url), 'utf8');
const compactAudit = readFileSync(new URL('../../scripts/audit-pages-mobile-compact.mjs', import.meta.url), 'utf8');

test('production browser audit covers every current dashboard route', () => {
  for (const mode of [
    'current', 'daily', 'hinata', 'nogizaka', 'ranking', 'followers',
    'played-tracks', 'spotify', 'apple-music', 'amazon-music', 'youtube-music',
    'likes', 'broadcasts',
  ]) {
    assert.match(audit, new RegExp(`name: '${mode}'`));
  }
  for (const path of [
    'daily', 'hinata', 'nogizaka', 'ranking', 'followers', 'played-tracks',
    'spotify', 'apple-music', 'amazon-music', 'youtube-music', 'likes', 'broadcasts',
  ]) {
    assert.match(audit, new RegExp(`path: '\\/#${path}'`));
  }
  assert.match(audit, /panel: '#spotifyView'/);
  assert.match(audit, /panel: '#appleMusicView'/);
  assert.match(audit, /panel: '#amazonMusicView'/);
  assert.match(audit, /panel: '#youtubeMusicView'/);
  assert.doesNotMatch(audit, /name: 'first-week'/);
  assert.doesNotMatch(audit, /path: '\/#first-week'/);
  assert.doesNotMatch(audit, /name: 'weekly'/);
  assert.doesNotMatch(audit, /name: 'monthly'/);
  assert.doesNotMatch(audit, /path: '\/#weekly'/);
  assert.doesNotMatch(audit, /path: '\/#monthly'/);
  assert.doesNotMatch(audit, /path: '\/#unofficial'/);
  assert.match(audit, /requiredText: '非公式リスパ一覧'/);
  assert.match(audit, /additionalRequiredText: '比較対象'/);
});

test('production browser audit captures desktop tablet and mobile layouts', () => {
  assert.match(audit, /name: 'desktop', width: 1440, height: 1000/);
  assert.match(audit, /name: 'tablet', width: 820, height: 1180/);
  assert.match(audit, /name: 'mobile', width: 390, height: 844/);
  assert.match(audit, /name: 'mobile-compact', width: 320, height: 720/);
  assert.equal((audit.match(/modes: MODES\.map\(\(\{ name \}\) => name\)/g) || []).length, 4);
  assert.match(audit, /horizontalOverflow/);
  assert.match(audit, /clippedTabs/);
  assert.match(audit, /clippedWithoutScroll/);
  assert.match(audit, /navigationScrollable/);
  assert.match(audit, /selectedTabClipped/);
  assert.match(audit, /visiblePanels/);
  assert.match(audit, /duplicateIds/);
  assert.doesNotMatch(audit, /'#firstWeekView'.*visiblePanels/);
  assert.match(audit, /clippedWithoutScroll\) > 0/);
});

test('production browser audit checks rendered data quality without brittle service headings', () => {
  assert.match(audit, /requiredText: '更新周期'/);
  assert.doesNotMatch(audit, /requiredText: '総週数'/);
  assert.match(audit, /malformedTokens/);
  assert.match(audit, /'NaN'/);
  assert.match(audit, /'undefined'/);
  assert.match(audit, /'Invalid Date'/);
  assert.match(audit, /missingCells/);
  assert.match(audit, /tableCells/);
  assert.doesNotMatch(audit, /requiredText: '週間リーダーボード'/);
});

test('full-page screenshots reveal content-visibility sections before capture', () => {
  assert.match(audit, /async function revealLazyContent/);
  assert.match(audit, /window\.scrollTo\(0, document\.documentElement\.scrollHeight\)/);
  assert.ok(audit.indexOf('await revealLazyContent(page)') < audit.indexOf('page.screenshot'));
});

test('compact production audit follows the current routes and scrollable navigation', () => {
  assert.doesNotMatch(compactAudit, /name: 'first-week'/);
  assert.doesNotMatch(compactAudit, /path: '\/#first-week'/);
  assert.doesNotMatch(compactAudit, /name: 'weekly'/);
  assert.doesNotMatch(compactAudit, /name: 'monthly'/);
  assert.doesNotMatch(compactAudit, /path: '\/#weekly'/);
  assert.doesNotMatch(compactAudit, /path: '\/#monthly'/);
  assert.match(compactAudit, /requiredText: '更新周期'/);
  assert.match(compactAudit, /additionalRequiredText: '比較対象'/);
  assert.match(compactAudit, /navigationScrollable/);
  assert.match(compactAudit, /selectedTabClipped/);
  assert.match(compactAudit, /clippedTabs > 0 && !layout\.navigationScrollable/);
});
