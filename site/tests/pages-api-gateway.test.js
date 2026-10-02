  };
}

async function withFixedNow(action) {
  const realDateNow = Date.now;
  Date.now = () => NOW;
  try {
    return await action();
  } finally {
    Date.now = realDateNow;
  }
}

test('Pages API catalog exposes exactly the canonical routes without Worker URLs', async () => {
  const catalog = apiCatalog(NOW);
  assert.equal(catalog.gateway, 'cloudflare-pages');
  assert.equal(catalog.contract_version, 20);
  assert.equal(catalog.worker_urls_public, false);
  const paths = Object.values(catalog.groups).flat().map(({ path }) => path);
  assert.deepEqual(paths, CANONICAL_PATHS);

  const response = await catalogRequest({ request: new Request('https://example.com/api') });
  assert.equal(response.status, 200);
  const rejected = await catalogRequest({ request: new Request('https://example.com/api', { method: 'POST' }) });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET');
});

test('unified Pages health combines all health components behind one URL', async () => {
  const env = {
    MINUTE_DB: minuteDb(minuteRows()),
    OTHER_DB: otherDb(),
    SOLO_BROADCAST_HANDLE: 'sakurazaka46jp',
  };
  const payload = await readHealth(env, NOW);
  assert.equal(payload.ok, true);