import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audit = readFileSync(new URL('../../scripts/audit-pages-live.mjs', import.meta.url), 'utf8');

test('production browser audit covers every dashboard route', () => {
  for (const mode of ['current', 'daily', 'weekly', 'monthly', 'ranking', 'first-week', 'played-tracks', 'likes', 'broadcasts', 'unofficial']) {
    assert.match(audit, new RegExp(`name: '${mode}'`));
  }
  assert.match(audit, /path: '\/#daily'/);
  assert.match(audit, /path: '\/#weekly'/);
  assert.match(audit, /path: '\/#monthly'/);
  assert.match(audit, /path: '\/#ranking'/);
  assert.match(audit, /path: '\/#likes'/);
  assert.match(audit, /path: '\/#broadcasts'/);
  assert.match(audit, /path: '\/#first-week'/);
  assert.match(audit, /path: '\/#played-tracks'/);
  assert.match(audit, /path: '\/#unofficial'/);
});

test('production browser audit captures desktop tablet and mobile layouts', () => {
  assert.match(audit, /name: 'desktop', width: 1440, height: 1000/);
  assert.match(audit, /name: 'tablet', width: 820, height: 1180/);
  assert.match(audit, /name: 'mobile', width: 390, height: 844/);
  assert.match(audit, /name: 'mobile-compact', width: 320, height: 720/);
  assert.match(audit, /horizontalOverflow/);
  assert.match(audit, /clippedTabs/);
  assert.match(audit, /visiblePanels/);
});

test('full-page screenshots reveal content-visibility sections before capture', () => {
  assert.match(audit, /async function revealLazyContent/);
  assert.match(audit, /window\.scrollTo\(0, document\.documentElement\.scrollHeight\)/);
  assert.ok(audit.indexOf('await revealLazyContent(page)') < audit.indexOf('page.screenshot'));
});