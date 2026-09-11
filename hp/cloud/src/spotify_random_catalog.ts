export const SHORT_SPOTIFY_RANDOM_TRACKS = [
  ["Sunny side up", "5xUQGRuP4LPk4ESl1xbmFs"],
  ["キスが苦い", "4PaLKbIU8NvguxcrjMvHXh"],
  ["やるしかないじゃん", "6GF0ZgT8wlksWrlLTfGmlU"],
  ["恋愛無双", "5vRGSkQiKlJudkJ2vUKIOe"],
  ["死んだふり", "6QmAwjzLQy6SjUyvGzSCG4"],
  ["Make or Break", "7vvZ1QHTdkoEXBiOBdxdIo"],
  ["行かないで", "3HdmFZGqZLNiCAfiNj4N84"],
  ["ドライフルーツ", "5DrxCKjopmd7UL1pJWqBHK"],
  ["Nightmare症候群", "2hi8kIoKC8tRMDajdkoYFL"],
] as const;

export const INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS = [
  ["Interlude #1", "1N339Ccfo6kqPHtS5ueJ0J"],
  ["Interlude #2", "57MZ2hsDSJMp9nzFIRFd0S"],
  ["Interlude #4", "4K3nO9hBA3UE62Dspjx19d"],
  ["Interlude #6", "3IceOend8QYv0mJLCfrxQq"],
  ["Overture", "3GdsVS4jIJ7RBiasVZlWul"],
] as const;

export const OFF_VOCAL_SPOTIFY_RANDOM_TRACKS = [
  ["やるしかないじゃん -OFF VOCAL ver.-", "04nk2Ee7qSnNwn6OG2hl3Q"],
  ["Nightmare症候群 -OFF VOCAL ver.-", "4hVECXakmpdqigQq1mJwNg"],
  ["Make or Break -OFF VOCAL ver.-", "51nXGT2UTljN9BdOgn0Utw"],
  ["死んだふり -OFF VOCAL ver.-", "1R5rm05YeYZSJiGzZPZx8l"],
  ["承認欲求 -OFF VOCAL ver.-", "17PV1rxc1KbMOTRKSRt2hd"],
  ["もう一曲　欲しいのかい？ -OFF VOCAL ver.-", "54VmTDaOAl0LVlOmYOFuFi"],
] as const;

export const MANAGED_SPOTIFY_RANDOM_TRACKS = [
  ...SHORT_SPOTIFY_RANDOM_TRACKS,
  ...INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
  ...OFF_VOCAL_SPOTIFY_RANDOM_TRACKS,
] as const;

export const MANAGED_SPOTIFY_RANDOM_TRACK_IDS =
  MANAGED_SPOTIFY_RANDOM_TRACKS.map(([, id]) => id);
