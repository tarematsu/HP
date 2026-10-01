import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audit = readFileSync(new URL('../../scripts/audit-pages-live.mjs', import.meta.url), 'utf8');
const compactAudit = readFileSync(new URL('../../scripts/audit-pages-mobile-compact.mjs', import.meta.url), 'utf8');

test('production browser audit covers every current dashboard route', () => {
  for (const mode of ['current', 'daily', 'ranking', 'first-week', 'played-tracks', 'spotify', 'likes', 'broadcasts']) {
    assert.match(audit, new RegExp(`name: '${mode}'`));
  }
  assert.match(audit, /path: '\/#daily'/);
  assert.match(audit, /path: '\/#ranking'/);
  assert.match(audit, /path: '\/#likes'/);
  assert.match(audit, /path: '\/#broadcasts'/);
  assert.match(audit, /path: '\/#first-week'/);
  assert.match(audit, /path: '\/#played-tracks'/);
  assert.match(audit, /path: '\/#spotify'/);
  assert.match(audit, /panel: '#spotifyView'/);
  assert.doesNotMatch(audit, /name: 'weekly'/);
  assert.doesNotMatch(audit, /name: 'monthly'/);
  assert.doesNotMatch(audit, /path: '\/#weekly'/);
  assert.doesNotMatch(audit, /path: '\/#monthly'/);
  assert.doesNotMatch(audit, /path: '\/#unofficial'/);
  assert.match(audit, /requiredText: '非公式リスパ一覧'/);
});

test('production browser audit captures desktop tablet and mobile layouts', () => {
  assert.match(audit, /name: 'desktop', width: 1440, height: 1000/);
  assert.match(audit, /name: 'tablet', width: 820, height: 1180/);
  assert.match(audit, /name: 'mobile', width: 390, height: 844/);
  assert.match(audit, /name: 'mobile-compact', width: 320, height: 720/);
  assert.match(audit, /horizontalOverflow/);
  assert.match(audit, /clippedTabs/);
  assert.match(audit, /navigationScrollable/);
  assert.match(audit, /selectedTabClipped/);
  assert.match(audit, /visiblePanels/);
  assert.match(audit, /clippedTabs\) > 0 && !layout\.navigationScrollable/);
});

test('production browser audit follows current rendered labels', () => {
  assert.match(audit, /requiredText: '総週数'/);
  assert.match(audit, /requiredText: '櫻坂46の再生数一覧'/);
  assert.doesNotMatch(audit, /requiredText: '週間リーダーボード'/);
  assert.doesNotMatch(audit, /requiredText: '櫻坂46 再生数一覧'/);
});

test('full-page screenshots reveal content-visibility sections before capture', () => {
  assert.match(audit, /async function revealLazyContent/);
  assert.match(audit, /window\.scrollTo\(0, document\.documentElement\.scrollHeight\)/);
  assert.ok(audit.indexOf('await revealLazyContent(page)') < audit.indexOf('page.screenshot'));
});

test('compact production audit follows the current routes and scrollable navigation', () => {
  assert.doesNotMatch(compactAudit, /name: 'weekly'/);
  assert.doesNotMatch(compactAudit, /name: 'monthly'/);
  assert.doesNotMatch(compactAudit, /path: '\\/#weekly'/);
  assert.doesNotMatch(compactAudit, /path: '\\/#monthly'/);
  assert.match(compactAudit, /requiredText: '総週数'/);
  assert.match(compactAudit, /navigationScrollable/);
  assert.match(compactAudit, /selectedTabClipped/);
  assert.match(compactAudit, /clippedTabs > 0 && !layout\.navigationScrollable/);
});
