import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LATE_WINDOW_MS,
  OFFICIAL_STATUS_CACHE_CONTROL,
  officialAnnouncementSql,
  officialLateWindowMs,
  officialMainSql,
  officialStatusPayload,
} from '../functions/lib/official-account-status.js';

test('official account status shares late-window and cache policy', () => {
  assert.equal(OFFICIAL_STATUS_CACHE_CONTROL, 'no-store');
  assert.equal(DEFAULT_LATE_WINDOW_MS, 90 * 60_000);
  assert.equal(officialLateWindowMs({}), DEFAULT_LATE_WINDOW_MS);
  assert.equal(officialLateWindowMs({ OFFICIAL_NEWS_LATE_WINDOW_MS: 600_000 }), 600_000);
});

test('official announcement query uses the common delayed-start window', () => {
  const sql = officialAnnouncementSql('sh_official_news_announcements');
  assert.match(sql, /status='active'/);
  assert.match(sql, /status='scheduled' AND scheduled_at>=\?/);
});

test('official main query excludes collection-test windows by target handle', () => {
  const sakura = officialMainSql({
    tableName: 'sh_sakurazaka46jp_main',
    handle: 'sakurazaka46jp',
    limit: 180,
  });
  const nogi = officialMainSql({
    tableName: 'sh_nogizaka46smej_main',
    handle: 'nogizaka46smej',
    limit: 1,
  });
  for (const [sql, handle] of [[sakura, 'sakurazaka46jp'], [nogi, 'nogizaka46smej']]) {
    assert.match(sql, /sh_sakurazaka46jp_collection_tests/);
    assert.match(sql, new RegExp(`target_handle='${handle}'`));
  }
  assert.match(sakura, /LIMIT 180$/);
  assert.match(nogi, /LIMIT 1$/);
});

test('official status payload shares response shape and refresh cadence', () => {
  const generatedAt = 1_700_000_100_000;
  const payload = officialStatusPayload({
    handle: 'nogizaka46smej',
    generatedAt,
    event: { status: 'active' },
    samples: [{ observed_at: generatedAt - 5_000, listener_count: 10 }],
  });
  assert.equal(payload.collection_active, true);
  assert.equal(payload.latest.listener_count, 10);
  assert.equal(payload.latest_age_ms, 5_000);
  assert.equal(payload.recent_limit, 180);
  assert.equal(payload.refresh_hint_ms, 15_000);
});
