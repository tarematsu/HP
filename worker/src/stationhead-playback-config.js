function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function positiveInteger(value, fallback, maximum = 20) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function stationheadPlaybackEnabled(env = {}) {
  return enabled(
    env.STATIONHEAD_R2_PLAYBACK_ENABLED
      ?? env.BUDDIES_R2_PLAYBACK_ENABLED,
  );
}

export function stationheadPlaybackVisibleTracks(env = {}, fallback = 6) {
  return positiveInteger(
    env.STATIONHEAD_PLAYBACK_VISIBLE_TRACKS
      ?? env.BUDDIES_PLAYBACK_VISIBLE_TRACKS,
    fallback,
    20,
  );
}
