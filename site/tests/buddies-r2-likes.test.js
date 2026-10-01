import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRACK_LIKE_REALTIME_SQL,
  TRACK_LIKE_R2_REALTIME_SQL,
} from '../functions/lib/track-likes.js';

test('Buddies R2 like observations carry Stationhead title and artist without queue-item joins', () => {
  assert.match(TRACK_LIKE_R2_REALTIME_SQL, /json_extract\(raw_json,'\$\.title'\) AS title/);
  assert.match(TRACK_LIKE_R2_REALTIME_SQL, /json_extract\(raw_json,'\$\.artist'\) AS artist/);
  assert.doesNotMatch(TRACK_LIKE_REALTIME_SQL, /raw_json/);
});
