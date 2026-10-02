export const SPOTIFY_FAST_RETRY_END_HOUR_JST = 5;
export const SPOTIFY_ARTIST_CHART_START_HOUR_JST = 7;
export const SPOTIFY_ARTIST_CHART_END_HOUR_JST = 11;

export function spotifyJstHour(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return (date.getUTCHours() + 9) % 24;
}

export function spotifyUtcMinute(timestamp = Date.now()) {
  return new Date(timestamp).getUTCMinutes();
}

export function isSpotifyFastRetryWindow(timestamp = Date.now()) {
  return spotifyJstHour(timestamp) < SPOTIFY_FAST_RETRY_END_HOUR_JST;
}

export function isSpotifyHourlyBoundary(timestamp = Date.now()) {
  return spotifyUtcMinute(timestamp) === 0;
}

export function shouldDispatchSpotifyPlaycount(timestamp = Date.now()) {
  const minute = spotifyUtcMinute(timestamp);
  return minute === 0 || (isSpotifyFastRetryWindow(timestamp) && minute % 10 === 0);
}

export function shouldDispatchSpotifyArtistChart(timestamp = Date.now()) {
  const hour = spotifyJstHour(timestamp);
  return spotifyUtcMinute(timestamp) === 20
    && hour >= SPOTIFY_ARTIST_CHART_START_HOUR_JST
    && hour <= SPOTIFY_ARTIST_CHART_END_HOUR_JST;
}
