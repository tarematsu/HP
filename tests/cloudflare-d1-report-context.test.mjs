import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './helpers/source-contract.mjs';

const daily = readSource('scripts/cloudflare-d1-usage.mjs');
const rolling = readSource('scripts/cloudflare-d1-hourly-usage.mjs');
const queryCosts = readSource('.github/scripts/query-cloudflare-d1-costs.py');

test('manual D1 reports use the resolved Cloudflare account without REST discovery', () => {
  for (const source of [daily, rolling, queryCosts]) {
    assert.match(source, /CLOUDFLARE_ACCOUNT_ID/);
    assert.match(source, /resolved CLOUDFLARE_ACCOUNT_ID/);
    assert.doesNotMatch(source, /accounts\?per_page=50|discoverAccounts|def account_id|REST_API/);
  }
});

test('daily and rolling D1 usage query GraphQL once and retain repository scope', () => {
  for (const source of [daily, rolling]) {
    assert.match(source, /api\.cloudflare\.com\/client\/v4\/graphql/);
    assert.match(source, /repository-referenced-databases/);
    assert.match(source, /if \(!referenced\.has\(databaseId\)\) continue/);
    assert.match(source, /accounts: \[\{ id: accountId, name: null \}\]/);
    assert.doesNotMatch(source, /\/d1\/database\?per_page=100|for \(const account of accounts\)/);
  }
});

test('D1 query-cost collector remains privacy-preserving GraphQL only', () => {
  assert.match(queryCosts, /d1QueriesAdaptiveGroups/);
  assert.match(queryCosts, /sanitize_query/);
  assert.match(queryCosts, /hashlib\.sha256/);
  assert.doesNotMatch(queryCosts, /\/d1\/database|wrangler d1 insights/);
});
