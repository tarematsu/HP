import assert from 'node:assert/strict';
import test from 'node:test';
import {KUGOU_MUSIC_WEEKDAY_JST_HOUR,NETEASE_MUSIC_WEEKLY_JST_DAY,NETEASE_MUSIC_WEEKLY_JST_HOUR,QQ_MUSIC_WEEKLY_JST_DAY,QQ_MUSIC_WEEKLY_JST_HOUR,REGIONAL_MUSIC_DAILY_SERVICES,REGIONAL_MUSIC_DISPATCH_UTC_HOUR,REGIONAL_MUSIC_EVERY_DAY,REGIONAL_MUSIC_WEEKLY_SERVICES,regionalMusicR2DueServices,regionalMusicDispatchForTimestamp,enqueueRegionalMusicDispatch} from '../src/regional-music-dispatch-plan.js';

test('regional cadence keeps NetEase Tuesday 16:00, Monday standard services, QQ Thursday 18:00 and Kugou weekdays 11:30',()=>{
  assert.equal(REGIONAL_MUSIC_DISPATCH_UTC_HOUR,15);
  assert.equal(NETEASE_MUSIC_WEEKLY_JST_DAY,2);
  assert.equal(NETEASE_MUSIC_WEEKLY_JST_HOUR,16);
  assert.equal(QQ_MUSIC_WEEKLY_JST_DAY,4);
  assert.equal(QQ_MUSIC_WEEKLY_JST_HOUR,18);
  assert.equal(KUGOU_MUSIC_WEEKDAY_JST_HOUR,11);
  assert.deepEqual(REGIONAL_MUSIC_EVERY_DAY,[]);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-03T15:00:00Z')),[]);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-04T15:00:00Z')),REGIONAL_MUSIC_WEEKLY_SERVICES);
  assert.equal(new Set(regionalMusicR2DueServices(Date.parse('2026-10-04T15:00:00Z'))).size,17);
  assert.equal(REGIONAL_MUSIC_WEEKLY_SERVICES.includes('kkbox'),true);
  assert.equal(REGIONAL_MUSIC_WEEKLY_SERVICES.includes('qq_music'),false);
  assert.equal(REGIONAL_MUSIC_WEEKLY_SERVICES.includes('netease_cloud_music'),false);
  assert.equal(REGIONAL_MUSIC_WEEKLY_SERVICES.includes('kugou_music'),false);
  assert.equal(REGIONAL_MUSIC_DAILY_SERVICES.length,20);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-06T07:00:00Z')),['netease_cloud_music']);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-06T06:00:00Z')),[]);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-06T08:00:00Z')),[]);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-08T09:00:00Z')),['qq_music']);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-08T02:30:00Z')),['kugou_music']);
  assert.deepEqual(regionalMusicR2DueServices(Date.parse('2026-10-10T02:30:00Z')),[]);
});

test('old minute scheduler never enqueues duplicate D1 collectors',async()=>{
  const env={REGIONAL_MUSIC_QUEUE:{send:async()=>{throw new Error('must not enqueue');}}};
  for(const hour of [7,15,21]) for(let minute=0;minute<60;minute++) {
    const timestamp=Date.UTC(2026,9,4,hour,minute);
    assert.equal(regionalMusicDispatchForTimestamp(timestamp),null);
    assert.equal(await enqueueRegionalMusicDispatch(env,timestamp),null);
  }
});
