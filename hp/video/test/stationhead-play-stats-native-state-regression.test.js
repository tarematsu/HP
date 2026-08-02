import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url), 'utf8');
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const media = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8');

test('native state owns stats timestamps and response generations', () => {
  for (const fragment of [
    'dailyPlayStatsServerDateAt = 0',
    'dailyPlayStatsReceivedAt = 0',
    'statsDocumentGeneration_ = 0',
    'statsAuthGeneration_ = 0',
    'statsLastAcceptedRequestId_ = 0',
  ]) assert.match(header, new RegExp(fragment));
});

test('navigation invalidates outgoing stats before the new document', () => {
  const start = webview.indexOf('add_NavigationStarting');
  const invalidation = webview.indexOf('statsDocumentGeneration_ = 0', start);
  const navigationId = webview.indexOf('activeNavigationId_.store', start);
  assert.ok(start >= 0 && invalidation > start && invalidation < navigationId);
});

test('native reducer checks document, auth, and request order', () => {
  assert.match(webview, /type == L"stationhead-stats-document"/);
  assert.match(webview, /documentGeneration != statsDocumentGeneration_/);
  assert.match(webview, /authGeneration != statsAuthGeneration_/);
  assert.match(webview, /requestId <= statsLastAcceptedRequestId_/);
  assert.match(webview, /ignored stale authenticated stats result/);
  assert.match(webview, /statsAuthGeneration_ == 0/);
  assert.match(webview, /kMaximumSafeJsonInteger = 9007199254740991\.0/);
  assert.match(webview, /std::trunc\(value\) != value/);
});

test('native reducer normalizes chart data independently', () => {
  assert.match(webview, /kMaximumFuturePointMs/);
  assert.match(webview, /kMaximumPastPointMs/);
  assert.match(webview, /std::numeric_limits<int>::max/);
  assert.match(webview, /std::sort\(/);
  assert.match(webview, /normalized\.back\(\)\.dayStartMsUtc/);
  assert.match(webview, /timestamp % kDayMilliseconds/);
  assert.match(webview, /normalized\.size\(\) > 45/);
});

test('controller recreation preserves the native last-good snapshot', () => {
  const reset = webview.indexOf('status_ = {};');
  const saved = webview.lastIndexOf(
    'const auto dailyPlayCounts = status_.dailyPlayCounts;', reset);
  const restored = webview.indexOf(
    'status_.dailyPlayCounts = dailyPlayCounts;', reset);
  assert.ok(saved >= 0 && saved < reset && restored > reset);
  assert.match(webview, /dailyPlayStatsServerDateAt/);
  assert.match(webview, /dailyPlayStatsReceivedAt/);
});

test('renderer projects trusted server time for UTC period labels', () => {
  assert.match(media, /statsReferenceNowMs/);
  assert.match(media, /dailyPlayStatsServerDateAt/);
  assert.match(media, /dailyPlayStatsReceivedAt/);
  assert.match(media, /StationheadUtcDayOrdinal\(statsReferenceNowMs\)/);
  assert.match(media, /SummarizeStationheadDailyPlays\([\s\S]*statsReferenceNowMs/);
});
