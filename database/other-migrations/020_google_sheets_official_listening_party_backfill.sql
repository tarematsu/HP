-- Canonical historical official-listening-party series imported from the read-only Google Sheet.
-- Source of truth: 公式リスパ - 櫻坂ステへ統計 (gid=0).
CREATE TABLE IF NOT EXISTS sh_official_broadcast_series (
  host_handle TEXT NOT NULL,
  event_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  points_json TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL,
  PRIMARY KEY(host_handle,event_name)
);
CREATE INDEX IF NOT EXISTS idx_sh_official_series_started
ON sh_official_broadcast_series(host_handle,started_at);

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party',1721732400000,'[[5,962,1],[6,970,1],[7,985,1],[8,990,1],[9,980,1],[10,970,1],[11,980,1],[12,1010,1],[13,1030,1],[14,1020,1],[15,1020,1],[16,1020,1],[17,1030,1],[18,1000,1],[19,1010,1],[20,1020,1],[21,1040,1],[22,1040,1],[23,1050,1],[24,1040,1],[25,1030,1],[26,1030,1],[27,1030,1],[28,1040,1],[29,1030,1],[30,1040,1],[31,1050,1],[32,1050,1],[33,1040,1],[34,1070,1],[35,1070,1],[36,1070,1],[37,1060,1],[38,1070,1],[39,1070,1],[40,1080,1],[41,1070,1],[42,1070,1],[43,1060,1],[44,1060,1],[45,1050,1],[46,1060,1],[47,1070,1],[48,1070,1],[49,1070,1],[50,1060,1],[51,1080,1],[52,1070,1],[53,1070,1],[54,1040,1],[55,1030,1],[56,1040,1],[57,1030,1],[58,1030,1],[59,1020,1],[60,1040,1],[61,1030,1],[62,1020,1],[63,1010,1],[64,1010,1],[65,990,1],[66,993,1],[67,990,1],[68,990,1],[69,995,1],[70,980,1],[71,985,1],[72,975,1],[73,980,1],[74,970,1],[75,966,1],[76,962,1],[77,963,1],[78,965,1],[79,956,1],[80,955,1],[81,950,1],[82,960,1],[83,956,1],[84,953,1],[85,953,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1721732400000,ended_at=1721737500000,
  started_jst='2024-07-23 20:00:00',ended_jst='2024-07-23 21:25:00',
  sample_count=81,listener_avg=1019.1,listener_max=1080,likes_max=NULL,distinct_tracks=2,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party';

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2024.11.22「4th YEAR ANNIVERSARY LIVE」開催直前！Stationheadリスニングパーティー',1732273200000,'[[0,117,1],[1,233,1],[2,287,1],[3,319,1],[4,513,1],[5,509,1],[6,550,1],[7,550,1],[8,569,1],[9,566,1],[10,581,1],[11,591,1],[12,604,1],[13,625,1],[15,615,1],[16,617,1],[17,622,1],[18,625,1],[19,635,1],[20,640,1],[21,627,1],[22,635,1],[23,638,1],[24,629,1],[25,633,1],[26,645,1],[27,645,1],[28,648,1],[29,641,1],[30,642,1],[31,645,1],[32,645,1],[33,645,1],[34,637,1],[35,638,1],[36,642,1],[37,652,1],[38,633,1],[39,636,1],[40,640,1],[41,640,1],[42,640,1],[43,643,1],[44,647,1],[45,641,1],[46,638,1],[47,641,1],[48,644,1],[50,635,1],[51,631,1],[52,631,1],[53,636,1],[54,631,1],[55,628,1],[56,630,1],[57,623,1],[58,636,1],[59,632,1],[60,623,1],[61,618,1],[62,614,1],[63,614,1],[65,612,1],[66,617,1],[67,609,1],[68,614,1],[69,616,1],[70,619,1],[71,621,1],[72,620,1],[73,622,1],[74,620,1],[75,621,1],[76,618,1],[77,614,1],[78,614,1],[79,605,1],[80,596,1],[81,598,1],[82,596,1],[84,599,1],[85,605,1],[86,605,1],[87,599,1],[88,592,1],[89,595,1],[90,605,1],[91,602,1],[92,603,1],[93,603,1],[94,593,1],[95,588,1],[96,586,1],[97,592,1],[98,579,1],[99,576,1],[100,579,1],[101,577,1],[102,574,1],[103,567,1],[104,555,1],[105,546,1],[106,545,1],[107,545,1],[108,542,1],[109,544,1],[110,546,1],[111,544,1],[112,540,1],[113,545,1],[114,538,1],[115,540,1],[116,545,1],[117,545,1],[118,542,1],[119,547,1],[120,547,1],[121,538,1],[123,543,1],[124,542,1],[125,538,1],[126,533,1],[127,532,1],[128,530,1],[129,529,1],[130,524,1],[131,518,1],[132,520,1],[133,516,1],[134,519,1],[135,514,1],[136,517,1],[137,517,1],[138,515,1],[139,515,1],[140,517,1],[141,516,1],[142,513,1],[143,510,1],[145,503,1],[146,506,1],[147,509,1],[148,508,1],[149,505,1],[150,504,1],[151,500,1],[152,501,1],[153,501,1],[154,502,1],[155,498,1],[156,502,1],[157,509,1],[158,509,1],[159,512,1],[160,511,1],[161,508,1],[162,496,1],[163,492,1],[164,488,1],[165,483,1],[166,487,1],[167,490,1],[168,482,1],[169,483,1],[170,481,1],[171,481,1],[172,481,1],[173,473,1],[174,472,1],[175,479,1],[176,470,1],[177,462,1],[178,464,1],[179,461,1],[180,458,1],[181,462,1],[182,461,1],[183,456,1],[184,456,1],[185,449,1],[186,453,1],[187,454,1],[188,447,1],[189,446,1],[190,439,1],[191,440,1],[192,439,1],[193,437,1],[194,438,1],[195,433,1],[196,434,1],[197,427,1],[198,421,1],[199,425,1],[200,424,1],[201,422,1],[202,422,1],[203,426,1],[204,422,1],[205,420,1],[206,422,1],[207,420,1],[208,422,1],[209,422,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1732273200000,ended_at=1732285740000,
  started_jst='2024-11-22 20:00:00',ended_jst='2024-11-22 23:29:00',
  sample_count=204,listener_avg=544.2,listener_max=652,likes_max=707,distinct_tracks=37,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2024.11.22「4th YEAR ANNIVERSARY LIVE」開催直前！Stationheadリスニングパーティー';

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2024.11.25「4th YEAR ANNIVERSARY LIVE」Stationheadリスニングパーティー',1732536000000,'[[0,162,1],[1,300,1],[2,348,1],[3,714,1],[4,712,1],[5,730,1],[6,790,1],[7,790,1],[8,790,1],[9,795,1],[10,781,1],[11,813,1],[12,806,1],[13,814,1],[15,826,1],[16,832,1],[17,819,1],[18,821,1],[19,824,1],[20,827,1],[21,814,1],[22,808,1],[23,812,1],[25,799,1],[27,823,1],[28,817,1],[29,815,1],[30,819,1],[31,837,1],[32,837,1],[33,839,1],[34,845,1],[35,842,1],[36,840,1],[37,835,1],[38,833,1],[39,843,1],[40,836,1],[41,839,1],[42,842,1],[43,843,1],[44,841,1],[45,839,1],[46,838,1],[47,842,1],[48,841,1],[49,841,1],[50,846,1],[51,848,1],[52,838,1],[53,838,1],[54,836,1],[55,832,1],[56,836,1],[57,840,1],[58,830,1],[59,820,1],[60,825,1],[61,825,1],[62,819,1],[63,815,1],[64,812,1],[65,818,1],[66,807,1],[67,807,1],[68,791,1],[70,794,1],[71,797,1],[72,798,1],[73,804,1],[75,798,1],[77,799,1],[78,795,1],[79,790,1],[80,790,1],[81,798,1],[82,799,1],[83,798,1],[84,796,1],[85,791,1],[86,782,1],[87,783,1],[88,783,1],[89,782,1],[90,785,1],[91,784,1],[92,785,1],[93,783,1],[94,773,1],[95,762,1],[96,758,1],[97,756,1],[98,755,1],[99,752,1],[100,745,1],[101,749,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1732536000000,ended_at=1732542060000,
  started_jst='2024-11-25 21:00:00',ended_jst='2024-11-25 22:41:00',
  sample_count=96,listener_avg=790.6,listener_max=848,likes_max=1380,distinct_tracks=25,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2024.11.25「4th YEAR ANNIVERSARY LIVE」Stationheadリスニングパーティー';

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2025.04.30 2nd Album『Addiction』Stationheadリスニングパーティー',1745938800000,'[[0,420,1],[1,558,1],[2,627,1],[3,659,1],[4,711,1],[5,729,1],[6,771,1],[7,753,1],[8,753,1],[9,740,1],[10,771,1],[12,891,1],[13,891,1],[14,891,1],[15,891,1],[16,891,1],[17,891,1],[18,891,1],[19,891,1],[20,930,1],[21,930,1],[22,940,1],[23,934,1],[24,944,1],[27,935,1],[35,935,1],[40,928,1],[45,929,1],[47,931,1],[48,921,1],[50,923,1],[55,927,1],[56,926,1],[57,923,1],[59,922,1],[62,910,1],[67,910,1],[73,905,1],[75,900,1],[77,900,1],[80,903,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1745938800000,ended_at=1745943600000,
  started_jst='2025-04-30 00:00:00',ended_jst='2025-04-30 01:20:00',
  sample_count=41,listener_avg=851.9,listener_max=944,likes_max=NULL,distinct_tracks=4,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2025.04.30 2nd Album『Addiction』Stationheadリスニングパーティー';

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー',1761664500000,'[[0,342,1],[1,614,1],[2,712,1],[3,762,1],[4,793,1],[5,815,1],[6,839,1],[8,853,1],[9,860,1],[10,868,1],[11,879,1],[12,882,1],[13,901,1],[16,894,1],[17,801,1],[19,846,1],[20,847,1],[21,846,1],[26,735,1],[28,687,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1761664500000,ended_at=1761666180000,
  started_jst='2025-10-29 00:15:00',ended_jst='2025-10-29 00:43:00',
  sample_count=20,listener_avg=788.8,listener_max=901,likes_max=NULL,distinct_tracks=5,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー';

INSERT INTO sh_official_broadcast_series(host_handle,event_name,started_at,points_json,source_ref,refreshed_at)
VALUES('sakurazaka46jp','2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』',1767092400000,'[[0,238,1],[1,370,1],[2,433,1],[3,452,1],[4,477,1],[5,509,1],[6,531,1],[7,565,1],[8,578,1],[9,595,1],[10,618,1],[11,640,1],[12,646,1],[13,657,1],[14,672,1],[15,686,1],[16,704,1],[17,709,1],[18,724,1],[19,738,1],[20,746,1],[21,757,1],[22,762,1],[23,774,1],[24,787,1],[25,795,1],[26,802,1],[27,807,1],[28,811,1],[29,827,1],[30,833,1],[31,838,1],[32,841,1],[33,847,1],[34,847,1],[35,857,1],[36,861,1],[37,863,1],[38,860,1],[39,857,1],[40,858,1],[41,872,1],[42,872,1],[43,874,1],[44,882,1],[45,884,1],[46,888,1],[47,891,1],[48,893,1],[49,895,1],[50,895,1],[51,906,1],[52,909,1],[53,911,1],[54,909,1],[55,912,1],[56,918,1],[57,922,1],[58,922,1],[59,926,1],[60,927,1],[61,930,1],[62,930,1],[63,939,1],[64,934,1],[65,934,1],[66,934,1],[67,933,1],[68,938,1],[69,944,1],[70,946,1],[71,944,1],[72,945,1],[73,949,1],[74,948,1],[75,951,1],[76,955,1],[77,957,1],[78,960,1],[79,965,1],[80,966,1],[81,960,1],[82,966,1],[83,969,1],[84,971,1],[85,970,1],[86,973,1],[87,978,1],[88,983,1],[89,981,1],[90,982,1],[91,979,1],[92,983,1],[93,966,1]]','google-sheets:1h3DzuQBJ2B56XoYjkWOdhjA7lHizB3gMeKQ2K17HM0M:gid=0',CAST(strftime('%s','now') AS INTEGER)*1000)
ON CONFLICT(host_handle,event_name) DO UPDATE SET
  started_at=excluded.started_at,points_json=excluded.points_json,source_ref=excluded.source_ref,refreshed_at=excluded.refreshed_at;

UPDATE sh_official_broadcast_summary SET
  started_at=1767092400000,ended_at=1767097980000,
  started_jst='2025-12-30 20:00:00',ended_jst='2025-12-30 21:33:00',
  sample_count=94,listener_avg=833.4,listener_max=983,likes_max=NULL,distinct_tracks=4,
  refreshed_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE host_handle='sakurazaka46jp' AND event_name='2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』';
