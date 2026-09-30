const TITLE_TRACKS = Object.freeze({
  '乃木坂46': [
    'ぐるぐるカーテン', 'おいでシャンプー', '走れ!Bicycle', '制服のマネキン', '君の名は希望',
    'ガールズルール', 'バレッタ', '気づいたら片想い', '夏のFree&Easy', '何度目の青空か?',
    '命は美しい', '太陽ノック', '今、話したい誰かがいる', 'ハルジオンが咲く頃', '裸足でSummer',
    'サヨナラの意味', 'インフルエンサー', '逃げ水', 'いつかできるから今日できる', 'シンクロニシティ',
    'ジコチューで行こう!', '帰り道は遠回りしたくなる', 'Sing Out!', '夜明けまで強がらなくてもいい', 'しあわせの保護色',
    '僕は僕を好きになる', 'ごめんねFingers crossed', '君に叱られた', 'Actually...', '好きというのはロックだぜ！',
    'ここにはないもの', '人は夢を二度見る', 'おひとりさま天国', 'Monopoly', 'チャンスは平等',
    'チートデイ', '歩道橋', 'ネーブルオレンジ', 'Same numbers', 'ビリヤニ',
    '最後に階段を駆け上がったのはいつだ？', '是非に及ばず',
  ],
  '櫻坂46': [
    "Nobody's fault", 'BAN', '流れ弾', '五月雨よ', '桜月', 'Start over!', '承認欲求',
    '何歳の頃に戻りたいのか？', '自業自得', 'I want tomorrow to come', 'UDAGAWA GENERATION',
    'Make or Break', 'Unhappy birthday構文', 'The growing up train', 'Lonesome rabbit', "What's “KAZOKU”?", '愛MUST BE',
  ],
  '日向坂46': [
    'キュン', 'ドレミソラシド', 'こんなに好きになっちゃっていいの？', 'ソンナコトナイヨ', '君しか勝たん',
    'ってか', '僕なんか', '月と星が踊るMidnight', 'One choice', 'Am I ready?', '君はハニーデュー',
    '絶対的第六感', '卒業写真だけが知ってる', 'Love yourself!', 'お願いバッハ！', 'クリフハンガー',
    'Kind of love', 'イチャイチャ虫',
  ],
});

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

const TITLE_TRACK_KEYS = new Map(Object.entries(TITLE_TRACKS).map(([group, titles]) => [
  group,
  new Set(titles.map(normalizeTitle)),
]));

export function isAmazonMusicTitleTrack(track) {
  const group = String(track?.group_name || '').trim();
  const key = normalizeTitle(track?.title);
  return Boolean(key && TITLE_TRACK_KEYS.get(group)?.has(key));
}

export function amazonMusicTitleTracks(group) {
  return [...(TITLE_TRACKS[group] || [])];
}
