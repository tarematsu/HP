import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const raw = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url),
  'utf8',
);
const script = [...raw.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');
const classifierStart = script.indexOf('  const promotedLabel =');
const classifierEnd = script.indexOf('  const installTimelineFilterCss =', classifierStart);
assert.ok(classifierStart >= 0 && classifierEnd > classifierStart);
const classifierSource = script.slice(classifierStart, classifierEnd);

test('X scroll reuses promotion scans, invalidates on recycled links, and rechecks before likes', () => {
  let now = 1000;
  let queries = 0;
  let permalink = '/artist/status/42';
  let label = 'Normal';
  const span = {
    get textContent() { return label; },
    closest: () => null,
  };
  const article = {
    querySelectorAll: selector => {
      assert.equal(selector, 'span');
      queries++;
      return [span];
    },
    querySelector: selector => {
      if (selector === 'time') {
        return { closest: () => ({ getAttribute: () => permalink }) };
      }
      return null;
    },
  };
  const runtime = runInNewContext(
    '(() => { const text = element => element.textContent; ' +
    classifierSource + '\nreturn { organicForScroll, isOrganic }; })()',
    { performance: { now: () => now }, WeakMap },
  );

  assert.equal(runtime.organicForScroll(article), true);
  for (let i = 0; i < 20; i++) runtime.organicForScroll(article);
  assert.equal(queries, 1, 'scroll bursts should not rescan all descendant spans');
  now += 450;
  assert.equal(runtime.organicForScroll(article), true);
  assert.equal(queries, 1, 'a normal scroll tick should reuse the cached classification');

  // Ad flags can appear after a scroll probe. Pre-click checks must bypass
  // the scroll-only cache and reject a newly promoted post immediately.
  label = 'Promoted';
  assert.equal(runtime.organicForScroll(article), true, 'scroll cache is bounded');
  assert.equal(runtime.isOrganic(article), false, 'trusted click guard reads live DOM');

  permalink = '/new-artist/status/99';
  assert.equal(runtime.organicForScroll(article), false,
    'a recycled React cell must not inherit the previous tweet classification');
  now += 901;
  label = 'Normal';
  assert.equal(runtime.organicForScroll(article), true, 'cache expires automatically');
  assert.ok(queries <= 5, 'only changed or expired entries need full classification');
  assert.match(script, /if \(!freshArticle \|\| !freshArticle\.isConnected \|\| !isOrganic\(freshArticle\)\)/);
});

test('48-hour author-cooldown posts bypass promotional span scanning', () => {
  const start = script.indexOf('  const targetY =');
  const end = script.indexOf('  const clickLikeButton =', start);
  assert.ok(start >= 0 && end > start);
  let cooldown = true;
  let classifications = 0;
  let filtered = false;
  const article = {
    isConnected: true,
    closest: () => null,
    getAttribute: () => filtered ? 'true' : null,
    hasAttribute: () => filtered,
    setAttribute: () => { filtered = true; },
    removeAttribute: () => { filtered = false; },
  };
  const scan = runInNewContext(
    '(() => { ' + script.slice(start, end) + '\nreturn scanTimeline; })()',
    {
      Math, innerHeight: 480, targetTolerancePx: 18,
      likedAuthors: new Map([['@liked', 123]]),
      recentlyLikedAuthor: () => cooldown,
      articleIdentity: () => ({ id: '1', author: '@liked' }),
      organicForScroll: () => { classifications++; return true; },
      validLikeButton: () => null,
      filterAttribute: 'data-homepanel-x-filtered',
    },
  );
  scan([article]);
  assert.equal(filtered, true);
  assert.equal(classifications, 0, 'known liked authors never need a spam/repost scan');

  cooldown = false;
  scan([article]);
  assert.equal(filtered, false, 'an expired cooldown restores the post');
  assert.equal(classifications, 1);
});
