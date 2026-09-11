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

// Spotify-streamable OFF VOCAL editions at or below the short-track cutoff.
export const OFF_VOCAL_SPOTIFY_RANDOM_TRACKS = [
  ["やるしかないじゃん -OFF VOCAL ver.-", "04nk2Ee7qSnNwn6OG2hl3Q"],
  ["Nightmare症候群 -OFF VOCAL ver.-", "4hVECXakmpdqigQq1mJwNg"],
  ["Make or Break -OFF VOCAL ver.-", "51nXGT2UTljN9BdOgn0Utw"],
  ["死んだふり -OFF VOCAL ver.-", "1R5rm05YeYZSJiGzZPZx8l"],
  ["承認欲求 -OFF VOCAL ver.-", "17PV1rxc1KbMOTRKSRt2hd"],
  ["もう一曲　欲しいのかい？ -OFF VOCAL ver.-", "54VmTDaOAl0LVlOmYOFuFi"],
  ["なぜ　恋をして来なかったんだろう？ -OFF VOCAL ver.-", "5TaAgmUQuhJw4bGW4dg3KI"],
] as const;

// Additional verified vocal tracks at or below 3:30. Keep these separate so the
// pre-existing managed pool remains an exact prefix for safe device migration.
export const ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS = [
  ["恋は向いてない", "44sj7vChwZRYQ0Oz9AFyP2"],
  ["摩擦係数", "5vOABxcejLNdoyLh7JRtjM"],
  ["もう一曲　欲しいのかい？", "3CzKqb5U3GlxUhoJGv1BZf"],
  ["一瞬の馬", "7jLbrfs3YtWO232XEU3iD1"],
  ["条件反射で泣けて来る", "5z8xkccoi9bnA8SGf2VQnk"],
  ["油を注せ！", "6oZVLkbhLB3qyikq0eNlEy"],
  ["泣かせて　Hold me tight!", "31vLfN5bNOpasgULiqSbLx"],
  ["ジャマイカビール", "37h3M4ZYJgSRy0cXArsH59"],
  ["承認欲求", "59G1ePHebLtol0u5upRFSZ"],
  ["なぜ　恋をして来なかったんだろう？", "2K6uY7BaeOfuPwJNOVF3ht"],
] as const;

// E/F/G use the complete short music pool. Instrumentals stay exclusive to C.
export const SHORT_SPOTIFY_ROTATION_TRACKS = [
  ...SHORT_SPOTIFY_RANDOM_TRACKS,
  ...OFF_VOCAL_SPOTIFY_RANDOM_TRACKS,
  ...ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS,
] as const;

// Keep newly discovered instrumental tracks appended after the existing managed
// pool so older device configs remain an exact prefix and migrate safely.
export const ADDITIONAL_INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS = [
  ["Interlude #3", "0LyOFxPXWLw2k0q4y9pFM3"],
  ["Interlude #5", "3rLKZOGLGRwMQ9XX4aECfN"],
  ["Interlude #7", "4OTvaYkw60M6YNZ59vlx0R"],
] as const;

export const SPOTIFY_B_ROTATION_TRACKS = [
  ["What's \"KAZOKU\"?", "33liCluqUasE65nMv3KLLm"],
  ["コインランドリー", "5QnQ7m9OxSoFeSPSz8grqX"],
  ["We got your back", "2ze5Hu3eRRe6HxJTfuZaA0"],
  ["各駅停車", "2CMSkSwIfnNQR7bTNFFeB5"],
  ["恵まれ過ぎて", "2meBhRDzQpf0ltQH11HbWG"],
] as const;

export const ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS = [
  ...INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
  ...ADDITIONAL_INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
] as const;

export const MANAGED_SPOTIFY_RANDOM_TRACKS = [
  ...SHORT_SPOTIFY_RANDOM_TRACKS,
  ...INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
  ...OFF_VOCAL_SPOTIFY_RANDOM_TRACKS,
  ...ADDITIONAL_INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
  ...ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS,
] as const;

export const MANAGED_SPOTIFY_RANDOM_TRACK_IDS =
  MANAGED_SPOTIFY_RANDOM_TRACKS.map(([, id]) => id);

const spotifyRotationTrack = (title: string, id: string) => ({
  title,
  url: `https://open.spotify.com/track/${id}`,
});

const rotationTracks = (tracks: readonly (readonly [string, string])[]) =>
  tracks.map(([title, id]) => spotifyRotationTrack(title, id));

export function managedSpotifySevenSlotRotation() {
  const shortSongs = rotationTracks(SHORT_SPOTIFY_ROTATION_TRACKS);
  return [
    {
      mode: "fixed",
      tracks: [spotifyRotationTrack("Lonesome Rabbit", "6Vy6hCA2CZwZalGqaX6Sew")],
    },
    {
      mode: "random",
      count: 1,
      tracks: rotationTracks(SPOTIFY_B_ROTATION_TRACKS),
    },
    {
      mode: "random",
      count: 1,
      tracks: rotationTracks(ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS),
    },
    {
      mode: "fixed",
      tracks: [spotifyRotationTrack("放課後BitterBlue", "5EjWZuODqEPQ9eq7XCmITh")],
    },
    { mode: "random", count: 1, tracks: shortSongs.map(track => ({ ...track })) },
    { mode: "random", count: 1, tracks: shortSongs.map(track => ({ ...track })) },
    {
      mode: "random",
      count: 1,
      includeTalkAbout: true,
      tracks: shortSongs.map(track => ({ ...track })),
    },
  ];
}
