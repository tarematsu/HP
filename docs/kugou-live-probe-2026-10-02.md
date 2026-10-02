# Kugou live probe — 2026-10-02

Observed at approximately 2026-10-02 09:59–10:20 JST from GitHub Actions. Read-only probe; no D1/R2 writes.

## Sakurazaka46 artist page

- Kugou author ID: `5317322`
- Public page: `https://pcretry.kugou.com/yueku/v8/singer/home/5317322-0-6-r.html`
- Page fetch: success
- Embedded `homeSongs`: 10 tracks

Current page order:

1. `Audition` — `DCA2F9BE76C605082133C64A99F6A877`
2. `愛MUST BE` — `82BEDAD5AF5AB929D82CE31AC7A5EC18`
3. `各駅停車` — `DD242FE942BC5FDCB56D9FE7253967F4`
4. `恵まれ過ぎて` — `88A0BCC736F9835F194D4C9BC6E64D3A`
5. `コインランドリー` — `76C1D5680EAE3E5D8A681018D9C848E5`
6. `The growing up train -OFF VOCAL ver.-` — `DFF6118443681D0EAEEAE6E97068712F`
7. `The growing up train` — `BAF2FEFA9948CF280CD21AA42B5177E4`
8. `光源 -OFF VOCAL ver.-` — `861D1AEF7F21EAB6998BAC1373863D73`
9. `光源` — `1974A9131530BF4D2511C94C981D79DE`
10. `What's "KAZOKU"?` — `0E48ED260898672C8C3901646929552C`

The page exposes these raw fields: `addtime`, `album_id`, `bitrate`, `c_mv_hash`, `duration`, `extname`, `filesize`, `has_accompany`, `hash`, `hash_320`, `hash_ape`, `hash_flac`, `high_mv_hash`, `id`, `is_file_head`, `is_mv_file_head`, `level`, `m4a_size`, `music_trac`, `mv_hash`, `mv_type`, `old_hide`, `ownercount`, `privilege`, `publish_time`, `quality`, `relate_goods`, `scid`, `singerid`, `singername`, `songname`, `vip`.

### Concrete samples

`愛MUST BE`:

- `scid`: `653343900`
- `album_id`: `207792323`
- `hash`: `82BEDAD5AF5AB929D82CE31AC7A5EC18`
- duration: `238000` ms
- bitrate: `128`
- filesize: `3817437`
- extension: `mp3`
- `ownercount`: `0`
- `privilege`: `8`
- `vip`: `0`
- `quality`: `2`
- `has_accompany`: `1`

`コインランドリー`:

- `scid`: `579136552`
- `album_id`: `194766719`
- duration: `206000` ms
- MV hash: `11C23909E100265B8CBCD8DE416B07D9`
- `mv_type`: `2`
- `is_mv_file_head`: `1`
- `music_trac`: `3`

`光源`:

- `scid`: `542436278`
- `album_id`: `194765496`
- duration: `227000` ms
- MV hash: `7E71C8129A4E30576755F4A9B86CF879`
- `mv_type`: `2`
- `is_mv_file_head`: `1`
- `music_trac`: `3`

`Audition` is correctly represented as a collaboration: `坂道選抜、乃木坂46、櫻坂46、日向坂46`.

## Comment count: confirmed collectable

For `愛MUST BE`, an unsigned read-only request to the public comment-count route succeeded:

`GET https://gateway.kugou.com/index.php?r=comments/getcommentsnum&code=fc4be23b4e972707f36b8a828a93ba8a&hash=82BEDAD5AF5AB929D82CE31AC7A5EC18`

with router header:

`x-router: sum.comment.service.kugou.com`

Response:

```json
{"82BEDAD5AF5AB929D82CE31AC7A5EC18":5}
```

So at probe time Kugou reported **5 comments** for `愛MUST BE`. This can map directly to the existing `regional_music_track_daily.comments` field without a schema migration.

## MV play count: confirmed collectable

The legacy public MV detail endpoint is still live and returns an unsigned `play_count` for current Sakurazaka46 MV hashes:

`GET https://m.kugou.com/app/i/mv.php?cmd=100&hash=<MV_HASH>&ismp3=1&ext=mp4`

Live results at approximately 2026-10-02 10:06 JST:

| title | MV hash | MV id | `play_count` | API status |
| --- | --- | ---: | ---: | ---: |
| `コインランドリー` | `11C23909E100265B8CBCD8DE416B07D9` | `15689380` | **26** | `1` |
| `光源` | `7E71C8129A4E30576755F4A9B86CF879` | `14569867` | **61** | `1` |

Both calls returned HTTP 200, `errcode: 0`, `is_publish: 1`, the expected song title and singer `櫻坂46`.

This metric is specifically **Kugou MV play count**, not the audio-track streaming count. It should therefore be stored separately from any future song/audio `plays` metric.

## Japan chart: full current top 100 confirmed

The current Kugou client ranking endpoint was successfully queried read-only with the normal anonymous Android request signature:

`POST https://gateway.kugou.com/openapi/kmr/v2/rank/audio`

Parameters used for the Japan chart:

- `rank_id`: `31312`
- `page`: `1`
- `pagesize`: `100`
- `appid`: `1005`
- `clientver`: `20489`
- no login/cookie/account authentication

The response returned HTTP 200, API `status: 1`, `error_code: 0`, and exactly **100** entries in `data.songlist`. No SSA/device challenge was returned.

The retrieved issue was:

- issue: `196`
- chart publish time: `2026-10-01 10:10:00`
- parent rank ID: `31312`

All 100 entries were checked against Japanese, English and Simplified-Chinese name variants for the three Sakamichi groups.

| group | entries in current Japan top 100 |
| --- | ---: |
| 櫻坂46 / Sakurazaka46 / 樱坂46 | **0** |
| 日向坂46 / Hinatazaka46 | **0** |
| 乃木坂46 / Nogizaka46 | **0** |

Therefore **Sakurazaka46 is not in the current Kugou Japan chart top 100 for issue 196**. This is a full top-100 check, not an inference from the public web page's truncated ranking display.

The endpoint also exposes useful historical-ranking fields per song, including current rank (`business.sort`), previous rank (`business.last_sort`), appearance/rank count (`business.rank_count`), issue number, chart publish time, `album_audio_id`, `audio_id`, album information and MV/video metadata. This makes weekly chart snapshot collection feasible with one ranking request.

## Favourite / collection count: not available unsigned

An unsigned request to `/count/v1/audio/mget_collect` returned transport HTTP 200 but API failure:

```json
{"errcode":20006,"errmsg":"签名错误","data":{},"status":0}
```

The current artist-page objects also expose `ownercount`, but it is `0` for all sampled Sakamichi tracks. Do not map this field to likes/favourites without further validation.

## Search endpoint

The legacy `msearchcdn.kugou.com/api/v3/search/song` endpoint returned `fetch failed` from the GitHub-hosted runner for Sakurazaka46, Hinatazaka46 and Nogizaka46. It should not be a required production dependency while the fixed artist pages remain healthy.

The old mobile ranking endpoint `m.kugou.com/rank/info` no longer returns the ranking dataset; it returns a generic `outsidetpl.html` configuration payload. Use the current `kmr/v2/rank/audio` endpoint for ranking research instead.

## Practical collection scope now

Can collect immediately with high confidence:

- artist presence / fixed author ID
- current 10-track artist-page order
- title and singer string
- track hash and `scid`
- `album_id`
- duration / bitrate / filesize / extension
- accompaniment flag
- MV presence and MV hash where present
- privilege / VIP / quality flags
- per-track comment count using the public hash-based route
- per-MV `play_count` using the public MV-detail route
- full 100-entry Japan chart snapshot, including current/previous rank and rank history counters

Not yet safe to treat as canonical metrics:

- `ownercount` as favourite count
- cumulative audio-track play count
- signed favourite-count API

The next production-worthy extension is comment-count collection plus MV play-count collection for tracks that expose an MV hash, and a low-frequency Japan-chart snapshot. Keep MV plays in a distinct metric because they are video views, not audio streams.
