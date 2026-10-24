import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './helpers/source-contract.mjs';
import { resolveConfiguredD1DatabaseId } from '../scripts/cloudflare-d1-database-resolver.mjs';

const workflow = readSource('.github/workflows/fetch-cloudflare-d1-usage.yml');
const daily = readSource('scripts/cloudflare-d1-usage.mjs');
const rolling = readSource('scripts/cloudflare-d1-hourly-usage.mjs');
const queryCosts = readSource('.github/scripts/query-cloudflare-d1-costs.py');

test('manual D1 reports use the resolved account and support placeholder D1 IDs', () => {
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

test('D1 query-cost metrics remain GraphQL and resolve only placeholder IDs by name', () => {
  assert.match(queryCosts, /d1QueriesAdaptiveGroups/);
  assert.match(queryCosts, /sanitize_query/);
  assert.match(queryCosts, /hashlib\.sha256/);
  assert.match(queryCosts, /request_database_id_by_name/);
  assert.match(queryCosts, /resolve_database_id/);
  assert.doesNotMatch(queryCosts, /wrangler d1 insights/);
});

test('placeholder D1 IDs resolve by exact database name; real IDs avoid REST lookup', async () => {
  const actualId = '9b2b4d61-2d73-4e12-9d23-0b0d9d6f1a42';
  let calls = 0;
  const resolved = await resolveConfiguredD1DatabaseId({
    databaseId: '00000000-0000-0000-0000-000000000000',
    databaseName: 'stationhead-ohisama',
    token: 'test-token',
    accountId: 'test-account',
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(options.method, 'GET');
      assert.equal(new URL(url).searchParams.get('name'), 'stationhead-ohisama');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          result: [
            { name: 'stationhead-ohisama', uuid: actualId },
            { name: 'stationhead-ohisama-archive', uuid: '2a2b4d61-2d73-4e12-9d23-0b0d9d6f1a42' },
          ],
        }),
      };
    },
  });
  assert.equal(resolved, actualId);
  assert.equal(calls, 1);

  const configured = '43c12c1e-886d-4496-9c37-61bc8a15bbd7';
  assert.equal(await resolveConfiguredD1DatabaseId({
    databaseId: configured,
    databaseName: 'stationhead-minute',
    token: 'test-token',
    accountId: 'test-account',
    fetchImpl: async () => { throw new Error('unexpected REST lookup'); },
  }), configured);
});

test('placeholder D1 IDs fail closed when name resolution is ambiguous or missing', async () => {
  await assert.rejects(resolveConfiguredD1DatabaseId({
    databaseId: '00000000-0000-0000-0000-000000000000',
    databaseName: 'stationhead-ohisama',
    token: 'test-token',
    accountId: 'test-account',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, result: [] }),
    }),
  }), /Expected exactly one Cloudflare D1 database named stationhead-ohisama, found 0/);
});

test('manual D1 workflow has one credential resolver and no unused npm cache', () => {
  assert.match(workflow, /uses: \.\/\.github\/actions\/cloudflare-context/);
  assert.match(workflow, /api-token: \$\{\{ secrets\.CLOUDFLARE_BUILDS_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /^\s{6}CLOUDFLARE_API_TOKEN:/m);
  assert.doesNotMatch(workflow, /cache: npm|cache-dependency-path|npm (?:ci|install)/);
});
