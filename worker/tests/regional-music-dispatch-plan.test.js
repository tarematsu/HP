import assert from 'node:assert/strict';
import test from 'node:test';
import {REGIONAL_MUSIC_DAILY_SERVICES,REGIONAL_MUSIC_DISPATCH_UTC_HOUR,regionalMusicR2DueServices,regionalMusicDispatchForTimestamp,enqueueRegionalMusicDispatch} from '../src/regional-music-dispatch-plan.js';
test('JST midnight Sunday collects only daily exceptions and Monday collects all 19 once',()=>{
  assert.equal(REGIONAL_MUSIC_DISPATCH_UTC_HOUR,15);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-03T15:00:00Z')),['netease_cloud_music','qq_music']);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-04T15:00:00Z')),REGIONAL_MUSIC_DAILY_SERVICES);
  assert.equal(new Set(regionalMusicR2DueServices(Date.parse('2026-10-04T15:00:00Z'))).size,19);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-05T15:00:00Z')),['netease_cloud_music','qq_music']);
});
test('old minute scheduler never enqueues duplicate D1 collectors',async()=>{
  const env={REGIONAL_MUSIC_QUEUE:{send:async()=>{throw new Error('must not enqueue');}}};
  for(const hour of [15,21]) for(let minute=0;minute<60;minute++) {
    const timestamp=Date.UTC(2026,9,4,hour,minute);
    assert.equal(regionalMusicDispatchForTimestamp(timestamp),null);
    assert.equal(await enqueueRegionalMusicDispatch(env,timestamp),null);
  }
});
