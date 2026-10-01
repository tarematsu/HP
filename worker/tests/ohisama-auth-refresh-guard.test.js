import assert from 'node:assert/strict';
import test from 'node:test';

import {
  guardedOhisamaAuthRefresh,
  resetOhisamaAuthRefreshGuardForTests,
} from '../src/ohisama-auth-refresh-guard.js';

function fakeEnv() {
  const control = {
    exists: false,
    last_attempt_at: null,
    last_success_at: null,
    last_error: null,
    lock_until: 0,
    updated_at: 0,
  };

  return {
    AUTH_LOCK_MS: 60_000,
    AUTH_REFRESH_COOLDOWN_MS: 300_000,
    control,
    OHISAMA_DB: {
      prepare(sql) {
        const text = String(sql);
        return {
          values: [],
          bind(...values) {
            this.values = values;
            return this;
          },
          async run() {
            if (/CREATE TABLE IF NOT EXISTS sh_worker_auth_control/.test(text)) {
              return { meta: { changes: 0 } };
            }
            if (/INSERT OR IGNORE INTO sh_worker_auth_control/.test(text)) {
              if (!control.exists) {
                control.exists = true;
                control.updated_at = this.values[1];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (/SET\s+lock_until=\?,last_attempt_at=\?,updated_at=\?/.test(text)) {
              const [lockUntil, attemptAt, updatedAt, , now, cooldownBoundary] = this.values;
              if (control.lock_until < now && (control.last_attempt_at ?? 0) <= cooldownBoundary) {
                control.lock_until = lockUntil;
                control.last_attempt_at = attemptAt;
                control.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (/last_success_at=CASE WHEN/.test(text)) {
              const [error, successAt, lastError, updatedAt] = this.values;
              if (error == null) control.last_success_at = successAt;
              control.last_error = lastError;
              control.lock_until = 0;
              control.updated_at = updatedAt;
              return { meta: { changes: 1 } };
            }
            throw new Error(`unexpected SQL: ${text}`);
          },
        };
      },
    },
  };
}

test('Ohisama auth refresh is serialized and records success', async () => {
  resetOhisamaAuthRefreshGuardForTests();
  const env = fakeEnv();
  let refreshes = 0;
  const now = 1_000_000;

  const result = await guardedOhisamaAuthRefresh(
    env,
    { now: () => now },
    async () => {
      refreshes += 1;
      return { authToken: 'new-token', deviceUid: 'device' };
    },
    async () => null,
    'old-token',
  );

  assert.equal(result.authToken, 'new-token');
  assert.equal(refreshes, 1);
  assert.equal(env.control.lock_until, 0);
  assert.equal(env.control.last_attempt_at, now);
  assert.equal(env.control.last_success_at, now);
  assert.equal(env.control.last_error, null);
});

test('Ohisama auth refresh respects cooldown instead of hammering Stationhead', async () => {
  resetOhisamaAuthRefreshGuardForTests();
  const env = fakeEnv();
  env.control.exists = true;
  env.control.last_attempt_at = 900_000;
  env.control.lock_until = 0;
  let refreshes = 0;

  await assert.rejects(
    guardedOhisamaAuthRefresh(
      env,
      {
        now: () => 1_000_000,
        sleep: async () => {},
      },
      async () => {
        refreshes += 1;
        return { authToken: 'should-not-run', deviceUid: 'device' };
      },
      async () => ({ authToken: 'old-token', deviceUid: 'device' }),
      'old-token',
    ),
    /deferred to protect Buddies collection/,
  );

  assert.equal(refreshes, 0);
  assert.equal(env.control.last_attempt_at, 900_000);
});
