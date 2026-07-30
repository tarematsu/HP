import assert from 'node:assert/strict';
import test from 'node:test';

import { runD1WriteGuard } from '../scripts/cloudflare-d1-write-guard.mjs';

test('D1 guard aggregates by database without sorting on an omitted time dimension', async () => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (_url, init) => {
    queries.push(JSON.parse(init.body).query);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: {
            viewer: {
              accounts: [{ d1AnalyticsAdaptiveGroups: [] }],
            },
          },
        });
      },
    };
  };

  try {
    const result = await runD1WriteGuard({
      token: 'test-token',
      accountId: 'test-account',
      databaseIds: new Set(['test-database']),
      now: Date.UTC(2026, 6, 30, 1, 30),
      readLimit: 3_500_000,
    });
    assert.equal(result.allowed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.doesNotMatch(query, /datetimeFifteenMinutes_ASC/);
    assert.match(query, /dimensions\s*\{\s*databaseId\s*\}/);
  }
});
