import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchStationheadFollowerProfile } from '../src/stationhead-daily-followers.js';

test('follower profiles use the production Stationhead account endpoint', async () => {
  let requestedUrl = '';
  const result = await fetchStationheadFollowerProfile('SakuraMankai', {
    session: {
      auth_token: 'token',
      device_uid: 'device',
    },
    fetchFn: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers.authorization, 'Bearer token');
      assert.equal(options.headers['sth-device-uid'], 'device');
      return Response.json({
        id: 3334889,
        handle: 'sakuramankai',
        followers: 4283,
      });
    },
  });

  assert.equal(
    requestedUrl,
    'https://production1.stationhead.com/account/handle/sakuramankai',
  );
  assert.deepEqual(result, {
    handle: 'sakuramankai',
    account_id: 3334889,
    followers: 4283,
  });
});
